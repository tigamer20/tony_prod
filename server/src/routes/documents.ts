import path from "node:path";
import { Router } from "express";
import { marked } from "marked";
import mammoth from "mammoth";
import multer from "multer";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { documentAudience, documentVisibilityWhere, SENSITIVE_DOC_TYPES } from "../access.js";
import { can, requirePerm } from "../auth.js";
import { prisma } from "../db.js";
import { badRequest, forbidden, HttpError, notFound, param, parse } from "../lib/http.js";
import { toDocx, toMarkdown, toPdf, toPlainText } from "../lib/export.js";
import { documentMentionIds } from "../lib/mentions.js";
import { miniUserSelect } from "../lib/serialize.js";
import { TEMPLATES, type PMNode } from "../lib/templates.js";
import { emitAll, emitToUsers } from "../realtime.js";

export const documentsRouter = Router();

const DOC_TYPES = ["SCRIPT", "CALL_SHEET", "SHOT_LIST", "TREATMENT", "SCHEDULE", "BUDGET", "CONTRACT", "NOTES", "OTHER"] as const;

const contentSchema = z.looseObject({ type: z.literal("doc"), content: z.array(z.any()).optional() });

const listSelect = {
  id: true,
  title: true,
  type: true,
  productionId: true,
  production: { select: { id: true, title: true, color: true } },
  createdBy: { select: miniUserSelect },
  updatedBy: { select: miniUserSelect },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DocumentSelect;

const detailSelect = { ...listSelect, content: true } satisfies Prisma.DocumentSelect;

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

async function loadVisible(user: NonNullable<Express.Request["user"]>, id: string) {
  const doc = await prisma.document.findFirst({ where: { id, ...documentVisibilityWhere(user) }, select: detailSelect });
  if (!doc) throw notFound("Document not found.");
  return doc;
}

function assertCanEdit(user: NonNullable<Express.Request["user"]>, doc: { createdBy: { id: string } }) {
  if (doc.createdBy.id !== user.id && !can(user, "documents.edit")) throw forbidden("You can only edit documents you created.");
}

function assertCanCreateType(user: NonNullable<Express.Request["user"]>, type: string) {
  if ((SENSITIVE_DOC_TYPES as readonly string[]).includes(type) && !can(user, "documents.sensitive")) {
    throw forbidden("You don't have access to budget or contract documents.");
  }
}

// ─── Templates & import ──────────────────────────────────────────────────

documentsRouter.get("/documents/templates", (_req, res) => {
  res.json(TEMPLATES.map(({ build: _b, ...t }) => t));
});

const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Converts an uploaded file to HTML. The browser turns that HTML into editor content
 * through the editor's schema, which discards anything it does not understand.
 */
documentsRouter.post("/documents/import", requirePerm("documents.create"), importUpload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest("No file received.");
  const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
  const ext = path.extname(originalName).toLowerCase();
  const title = path.basename(originalName, path.extname(originalName)).slice(0, 120) || "Imported document";

  let html: string;
  if (ext === ".docx") {
    try {
      html = (await mammoth.convertToHtml({ buffer: file.buffer })).value;
    } catch {
      throw badRequest("That Word file could not be read. Is it a valid .docx?");
    }
  } else if (ext === ".md" || ext === ".markdown") {
    html = await marked.parse(file.buffer.toString("utf8"), { async: true, gfm: true });
  } else if (ext === ".txt" || ext === ".fountain") {
    html = file.buffer
      .toString("utf8")
      .split(/\r?\n\s*\r?\n/)
      .map((block) => `<p>${escapeHtml(block).replace(/\r?\n/g, "<br>")}</p>`)
      .join("");
  } else {
    throw new HttpError(415, "Supported import formats: .docx, .md and .txt");
  }
  res.json({ title, html });
});

// ─── CRUD ────────────────────────────────────────────────────────────────

documentsRouter.get("/documents", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const type = typeof req.query.type === "string" && (DOC_TYPES as readonly string[]).includes(req.query.type) ? req.query.type : null;
  const rows = await prisma.document.findMany({
    where: {
      AND: [
        documentVisibilityWhere(req.user!),
        ...(typeof req.query.productionId === "string" ? [{ productionId: req.query.productionId }] : []),
        ...(type ? [{ type: type as (typeof DOC_TYPES)[number] }] : []),
        ...(q ? [{ title: { contains: q, mode: "insensitive" as const } }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: listSelect,
    take: 300,
  });
  res.json(rows);
});

const createSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(160),
  type: z.enum(DOC_TYPES).default("OTHER"),
  productionId: z.string().nullable().optional(),
  template: z.string().optional(),
  content: contentSchema.optional(),
});

documentsRouter.post("/documents", requirePerm("documents.create"), async (req, res) => {
  const body = parse(createSchema, req.body);
  assertCanCreateType(req.user!, body.type);
  const template = body.template ? TEMPLATES.find((t) => t.key === body.template) : undefined;
  const content = body.content ?? template?.build() ?? { type: "doc", content: [{ type: "paragraph" }] };
  const doc = await prisma.document.create({
    data: {
      title: body.title,
      type: body.type,
      productionId: body.productionId ?? null,
      content: asJson(content),
      createdById: req.user!.id,
      updatedById: req.user!.id,
    },
    select: detailSelect,
  });
  emitAll("documents:changed", {});
  res.status(201).json(doc);
});

documentsRouter.get("/documents/:id", async (req, res) => {
  res.json(await loadVisible(req.user!, param(req, "id")));
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  type: z.enum(DOC_TYPES).optional(),
  productionId: z.string().nullable().optional(),
  content: contentSchema.optional(),
  /** The updatedAt the editor last saw; if the document has moved on we refuse to overwrite it. */
  expectedUpdatedAt: z.string().optional(),
});

const VERSION_GAP_MS = 10 * 60 * 1000;
const MAX_VERSIONS = 50;

async function snapshot(documentId: string, userId: string, force = false) {
  const current = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  const last = await prisma.documentVersion.findFirst({ where: { documentId }, orderBy: { createdAt: "desc" } });
  if (!force && last && Date.now() - +last.createdAt < VERSION_GAP_MS) return;
  await prisma.documentVersion.create({
    data: { documentId, title: current.title, content: asJson(current.content), createdById: userId },
  });
  const old = await prisma.documentVersion.findMany({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    skip: MAX_VERSIONS,
    select: { id: true },
  });
  if (old.length) await prisma.documentVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

documentsRouter.patch("/documents/:id", async (req, res) => {
  const user = req.user!;
  const existing = await loadVisible(user, param(req, "id"));
  assertCanEdit(user, existing);
  const { expectedUpdatedAt, content, ...rest } = parse(updateSchema, req.body);

  if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) {
    throw new HttpError(409, "Someone else changed this document while you were editing. Reload to see their changes.");
  }
  if (rest.type) assertCanCreateType(user, rest.type);

  if (content) await snapshot(existing.id, user.id);
  const updated = await prisma.document.update({
    where: { id: existing.id },
    data: { ...rest, ...(content ? { content: asJson(content) } : {}), updatedById: user.id },
    select: detailSelect,
  });

  // Notify people who were @mentioned in this save. Only mentions that are new since the last save count, so
  // autosaving the same document over and over never pings anyone twice.
  if (content) {
    const before = new Set(documentMentionIds(existing.content));
    const added = documentMentionIds(content).filter((id) => !before.has(id));
    if (added.length) {
      const allowed = new Set((await documentAudience({ type: updated.type, createdById: updated.createdBy.id })).map((u) => u.id));
      const targets = added.filter((id) => allowed.has(id));
      for (const userId of targets) {
        await prisma.mention.upsert({
          where: { userId_documentId: { userId, documentId: existing.id } },
          create: { userId, byId: user.id, documentId: existing.id },
          // Mentioned again after being removed: surface it as new.
          update: { byId: user.id, readAt: null, createdAt: new Date() },
        });
      }
      if (targets.length) {
        emitToUsers(targets, "mention:new", { kind: "document", by: user.displayName, documentId: existing.id, where: `"${updated.title}"` });
      }
    }
  }

  emitAll("documents:changed", { id: existing.id });
  res.json(updated);
});

/** Who can be @mentioned in this document (people who are allowed to open it), for the editor's autocomplete. */
documentsRouter.get("/documents/:id/mentionable", async (req, res) => {
  const doc = await loadVisible(req.user!, param(req, "id"));
  const audience = await documentAudience({ type: doc.type, createdById: doc.createdBy.id });
  res.json({ users: audience.sort((a, b) => a.displayName.localeCompare(b.displayName)) });
});

documentsRouter.delete("/documents/:id", async (req, res) => {
  const user = req.user!;
  const existing = await loadVisible(user, param(req, "id"));
  if (existing.createdBy.id !== user.id && !can(user, "documents.delete")) throw forbidden("You can only delete documents you created.");
  await prisma.document.delete({ where: { id: existing.id } });
  emitAll("documents:changed", {});
  res.json({ ok: true });
});

// ─── Version history ─────────────────────────────────────────────────────

documentsRouter.get("/documents/:id/versions", async (req, res) => {
  const doc = await loadVisible(req.user!, param(req, "id"));
  res.json(
    await prisma.documentVersion.findMany({
      where: { documentId: doc.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true, createdBy: { select: miniUserSelect } },
    }),
  );
});

documentsRouter.get("/documents/:id/versions/:versionId", async (req, res) => {
  const doc = await loadVisible(req.user!, param(req, "id"));
  const version = await prisma.documentVersion.findFirst({ where: { id: param(req, "versionId"), documentId: doc.id } });
  if (!version) throw notFound("Version not found.");
  res.json(version);
});

documentsRouter.post("/documents/:id/restore/:versionId", async (req, res) => {
  const user = req.user!;
  const doc = await loadVisible(user, param(req, "id"));
  assertCanEdit(user, doc);
  const version = await prisma.documentVersion.findFirst({ where: { id: param(req, "versionId"), documentId: doc.id } });
  if (!version) throw notFound("Version not found.");
  await snapshot(doc.id, user.id, true);
  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: { title: version.title, content: asJson(version.content), updatedById: user.id },
    select: detailSelect,
  });
  emitAll("documents:changed", { id: doc.id });
  res.json(updated);
});

// ─── Export ──────────────────────────────────────────────────────────────

const EXPORTS = {
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pdf: { mime: "application/pdf" },
  md: { mime: "text/markdown; charset=utf-8" },
  txt: { mime: "text/plain; charset=utf-8" },
} as const;

documentsRouter.get("/documents/:id/export", async (req, res) => {
  const format = String(req.query.format ?? "pdf") as keyof typeof EXPORTS;
  if (!(format in EXPORTS)) throw badRequest("Export format must be docx, pdf, md or txt.");
  const doc = await loadVisible(req.user!, param(req, "id"));
  const content = doc.content as unknown as PMNode;

  let body: Buffer | string;
  if (format === "docx") body = await toDocx(doc.title, content);
  else if (format === "pdf") body = await toPdf(doc.title, content);
  else if (format === "md") body = toMarkdown(doc.title, content);
  else body = toPlainText(doc.title, content);

  const fileName = `${doc.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "document"}.${format}`;
  res.setHeader("Content-Type", EXPORTS[format].mime);
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(body);
});
