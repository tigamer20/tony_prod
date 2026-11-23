import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { canAccessChannel } from "../access.js";
import { requirePerm } from "../auth.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { badRequest, notFound, param } from "../lib/http.js";

export const filesRouter = Router();

fs.mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 5 },
});

// Only these types are ever displayed inline; everything else is forced to download.
const INLINE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "video/mp4", "video/webm", "audio/mpeg", "audio/wav", "audio/ogg", "application/pdf",
]);

filesRouter.post("/uploads", requirePerm("files.upload"), upload.array("files", 5), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw badRequest("No file received.");
  const created = await Promise.all(
    files.map((f) =>
      prisma.attachment.create({
        data: {
          uploaderId: req.user!.id,
          // multer decodes the original name as latin1; restore UTF-8 names.
          fileName: Buffer.from(f.originalname, "latin1").toString("utf8").slice(0, 200),
          mimeType: f.mimetype || "application/octet-stream",
          size: f.size,
          storageKey: f.filename,
        },
        select: { id: true, fileName: true, mimeType: true, size: true },
      }),
    ),
  );
  res.status(201).json(created);
});

filesRouter.get("/files/:id", async (req, res) => {
  const att = await prisma.attachment.findUnique({
    where: { id: param(req, "id") },
    include: { message: { select: { channelId: true, deletedAt: true } } },
  });
  if (!att) throw notFound("File not found.");

  if (att.message) {
    if (att.message.deletedAt) throw notFound("File not found.");
    if (!(await canAccessChannel(req.user!, att.message.channelId))) throw notFound("File not found.");
  } else if (att.uploaderId !== req.user!.id) {
    throw notFound("File not found.");
  }

  const filePath = path.join(config.uploadDir, att.storageKey);
  if (!fs.existsSync(filePath)) throw notFound("File not found.");

  const inline = INLINE_TYPES.has(att.mimeType);
  res.setHeader("Content-Type", inline ? att.mimeType : "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
  );
  fs.createReadStream(filePath).pipe(res);
});
