import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { documentVisibilityWhere, visibleChannelWhere } from "../access.js";
import type { AuthUser } from "../auth.js";
import { prisma } from "../db.js";
import { param } from "../lib/http.js";
import { miniUserSelect } from "../lib/serialize.js";
import { emitToUsers } from "../realtime.js";

export const mentionsRouter = Router();

/** Only mentions the person can still open: not a deleted message, a channel they lost access to, or a restricted document. */
function visibleMentionsWhere(user: AuthUser): Prisma.MentionWhereInput {
  return {
    userId: user.id,
    OR: [
      { documentId: { not: null }, document: documentVisibilityWhere(user) },
      { messageId: { not: null }, message: { deletedAt: null }, channel: visibleChannelWhere(user) },
    ],
  };
}

mentionsRouter.get("/mentions", async (req, res) => {
  const user = req.user!;
  const where = visibleMentionsWhere(user);
  const [rows, unread] = await Promise.all([
    prisma.mention.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        by: { select: miniUserSelect },
        channel: { select: { id: true, name: true, type: true } },
        message: { select: { content: true } },
        document: { select: { id: true, title: true } },
      },
    }),
    prisma.mention.count({ where: { ...where, readAt: null } }),
  ]);

  res.json({
    unread,
    items: rows.map((m) => ({
      id: m.id,
      kind: m.documentId ? "document" : "message",
      everyone: m.everyone,
      createdAt: m.createdAt,
      readAt: m.readAt,
      by: m.by,
      channel: m.channel,
      snippet: m.message ? m.message.content.slice(0, 160) : null,
      document: m.document,
    })),
  });
});

mentionsRouter.post("/mentions/read-all", async (req, res) => {
  await prisma.mention.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  emitToUsers([req.user!.id], "mentions:changed", {});
  res.json({ ok: true });
});

mentionsRouter.post("/mentions/:id/read", async (req, res) => {
  await prisma.mention.updateMany({ where: { id: param(req, "id"), userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  emitToUsers([req.user!.id], "mentions:changed", {});
  res.json({ ok: true });
});
