import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { canAccessChannel, channelAudience, visibleChannelWhere } from "../access.js";
import { can, requirePerm } from "../auth.js";
import { prisma } from "../db.js";
import { badRequest, forbidden, notFound, param, parse, slugify } from "../lib/http.js";
import { chatMentions } from "../lib/mentions.js";
import { miniUserSelect } from "../lib/serialize.js";
import { emitAll, emitToChannel, emitToUsers, joinUsersToChannel } from "../realtime.js";

export const chatRouter = Router();

const messageInclude = {
  author: { select: miniUserSelect },
  attachments: { select: { id: true, fileName: true, mimeType: true, size: true } },
  reactions: { select: { emoji: true, userId: true } },
  replyTo: {
    select: { id: true, content: true, deletedAt: true, author: { select: { displayName: true } } },
  },
} as const;

type MessageRow = Awaited<ReturnType<typeof loadMessage>>;

async function loadMessage(id: string) {
  return prisma.message.findUniqueOrThrow({ where: { id }, include: messageInclude });
}

export function shapeMessage(m: NonNullable<MessageRow>) {
  const deleted = !!m.deletedAt;
  const grouped = new Map<string, string[]>();
  if (!deleted) for (const r of m.reactions) grouped.set(r.emoji, [...(grouped.get(r.emoji) ?? []), r.userId]);
  return {
    id: m.id,
    channelId: m.channelId,
    author: m.author,
    content: deleted ? "" : m.content,
    deleted,
    pinned: m.pinned && !deleted,
    mentionsEveryone: m.mentionsEveryone && !deleted,
    editedAt: m.editedAt,
    createdAt: m.createdAt,
    attachments: deleted ? [] : m.attachments,
    reactions: [...grouped.entries()].map(([emoji, userIds]) => ({ emoji, userIds })),
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          author: m.replyTo.author.displayName,
          content: m.replyTo.deletedAt ? "" : m.replyTo.content.slice(0, 140),
          deleted: !!m.replyTo.deletedAt,
        }
      : null,
  };
}

// ─── Channels ────────────────────────────────────────────────────────────

chatRouter.get("/channels", async (req, res) => {
  const user = req.user!;
  const channels = await prisma.channel.findMany({
    where: visibleChannelWhere(user),
    orderBy: [{ category: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    include: {
      allowedRoles: { select: { id: true } },
      members: { select: { userId: true, lastReadAt: true, user: { select: miniUserSelect } } },
    },
  });

  // New channels start as "read" for people who have never opened them.
  const missing = channels.filter((c) => !c.members.some((m) => m.userId === user.id));
  if (missing.length) {
    await prisma.channelMember.createMany({
      data: missing.map((c) => ({ channelId: c.id, userId: user.id })),
      skipDuplicates: true,
    });
  }

  const result = await Promise.all(
    channels.map(async (c) => {
      const mine = c.members.find((m) => m.userId === user.id);
      const unread = mine
        ? await prisma.message.count({
            where: { channelId: c.id, createdAt: { gt: mine.lastReadAt }, authorId: { not: user.id }, deletedAt: null },
          })
        : 0;
      return {
        id: c.id,
        name: c.name,
        topic: c.topic,
        type: c.type,
        category: c.category,
        position: c.position,
        isPrivate: c.isPrivate,
        productionId: c.productionId,
        allowedRoleIds: c.allowedRoles.map((r) => r.id),
        unread,
        dmUser: c.type === "DM" ? (c.members.find((m) => m.userId !== user.id)?.user ?? null) : null,
      };
    }),
  );
  res.json(result);
});

const channelSchema = z.object({
  name: z.string().trim().min(1, "Channel name is required.").max(40),
  topic: z.string().trim().max(200).nullable().optional(),
  category: z.string().trim().min(1).max(40).default("General"),
  isPrivate: z.boolean().default(false),
  roleIds: z.array(z.string()).default([]),
});

chatRouter.post("/channels", requirePerm("channels.manage"), async (req, res) => {
  const body = parse(channelSchema, req.body);
  const channel = await prisma.channel.create({
    data: {
      name: slugify(body.name),
      topic: body.topic ?? null,
      category: body.category,
      isPrivate: body.isPrivate,
      allowedRoles: { connect: body.roleIds.map((id) => ({ id })) },
    },
  });
  emitAll("channels:changed", {});
  res.status(201).json(channel);
});

chatRouter.patch("/channels/:id", requirePerm("channels.manage"), async (req, res) => {
  const channel = await prisma.channel.findUnique({ where: { id: param(req, "id") } });
  if (!channel || channel.type !== "TEXT") throw notFound("Channel not found.");
  const body = parse(channelSchema.partial(), req.body);
  const { roleIds, name, ...rest } = body;
  const updated = await prisma.channel.update({
    where: { id: channel.id },
    data: {
      ...rest,
      ...(name ? { name: slugify(name) } : {}),
      ...(roleIds ? { allowedRoles: { set: roleIds.map((id) => ({ id })) } } : {}),
    },
  });
  emitAll("channels:changed", {});
  res.json(updated);
});

/**
 * Deletes a conversation and every message and file in it. Channels need the "manage channels"
 * permission; a direct message can be deleted by either of the two people in it.
 */
chatRouter.delete("/channels/:id", async (req, res) => {
  const user = req.user!;
  const channel = await prisma.channel.findUnique({
    where: { id: param(req, "id") },
    include: { members: { select: { userId: true } } },
  });
  if (!channel) throw notFound("Conversation not found.");

  if (channel.type === "DM") {
    if (!channel.members.some((m) => m.userId === user.id)) throw notFound("Conversation not found.");
  } else if (!can(user, "channels.manage")) {
    throw forbidden();
  }

  await prisma.channel.delete({ where: { id: channel.id } });
  if (channel.type === "DM") emitToUsers(channel.members.map((m) => m.userId), "channels:changed", {});
  else emitAll("channels:changed", {});
  res.json({ ok: true });
});

chatRouter.post("/channels/dm", requirePerm("messages.send"), async (req, res) => {
  const { userId } = parse(z.object({ userId: z.string() }), req.body);
  const me = req.user!.id;
  if (userId === me) throw badRequest("You can't message yourself.");
  const other = await prisma.user.findFirst({ where: { id: userId, status: "ACTIVE" } });
  if (!other) throw notFound("Member not found.");

  let channel = await prisma.channel.findFirst({
    where: {
      type: "DM",
      AND: [{ members: { some: { userId: me } } }, { members: { some: { userId } } }],
    },
  });
  if (!channel) {
    channel = await prisma.channel.create({
      data: {
        name: "direct-message",
        type: "DM",
        category: "Direct Messages",
        isPrivate: true,
        members: { create: [{ userId: me }, { userId }] },
      },
    });
    joinUsersToChannel([me, userId], channel.id);
    emitToUsers([me, userId], "channels:changed", {});
  }
  res.json({ id: channel.id });
});

chatRouter.post("/channels/:id/read", async (req, res) => {
  const channel = await canAccessChannel(req.user!, param(req, "id"));
  if (!channel) throw notFound("Channel not found.");
  await prisma.channelMember.upsert({
    where: { channelId_userId: { channelId: channel.id, userId: req.user!.id } },
    create: { channelId: channel.id, userId: req.user!.id },
    update: { lastReadAt: new Date() },
  });
  // Opening a conversation counts as seeing the mentions in it.
  const cleared = await prisma.mention.updateMany({
    where: { userId: req.user!.id, channelId: channel.id, readAt: null },
    data: { readAt: new Date() },
  });
  if (cleared.count) emitToUsers([req.user!.id], "mentions:changed", {});
  res.json({ ok: true });
});

/** Who can be @mentioned in this channel (for the autocomplete), and whether @everyone is allowed. */
chatRouter.get("/channels/:id/mentionable", async (req, res) => {
  const channel = await canAccessChannel(req.user!, param(req, "id"));
  if (!channel) throw notFound("Channel not found.");
  const audience = await channelAudience(channel.id);
  res.json({
    users: audience.filter((u) => u.id !== req.user!.id).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    canEveryone: can(req.user!, "mentions.everyone") && channel.type !== "DM",
  });
});

// ─── Messages ────────────────────────────────────────────────────────────

chatRouter.get("/channels/:id/messages", async (req, res) => {
  const channel = await canAccessChannel(req.user!, param(req, "id"));
  if (!channel) throw notFound("Channel not found.");
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = typeof req.query.before === "string" ? req.query.before : null;
  const cursorMsg = before ? await prisma.message.findUnique({ where: { id: before }, select: { createdAt: true } }) : null;

  const rows = await prisma.message.findMany({
    where: { channelId: channel.id, ...(cursorMsg ? { createdAt: { lt: cursorMsg.createdAt } } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: messageInclude,
  });
  const hasMore = rows.length > limit;
  res.json({ messages: rows.slice(0, limit).reverse().map(shapeMessage), hasMore });
});

chatRouter.get("/channels/:id/pins", async (req, res) => {
  const channel = await canAccessChannel(req.user!, param(req, "id"));
  if (!channel) throw notFound("Channel not found.");
  const rows = await prisma.message.findMany({
    where: { channelId: channel.id, pinned: true, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: messageInclude,
  });
  res.json(rows.map(shapeMessage));
});

const sendSchema = z.object({
  content: z.string().max(4000).default(""),
  replyToId: z.string().nullable().optional(),
  attachmentIds: z.array(z.string()).max(10).default([]),
});

// Flood protection per person: plenty for real conversation, far too little for spamming Enter or a script.
const sendLimiter = rateLimit({
  windowMs: 10_000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.id,
  message: { error: "You're sending messages too fast. Wait a moment and try again." },
});

chatRouter.post("/channels/:id/messages", requirePerm("messages.send"), sendLimiter, async (req, res) => {
  const user = req.user!;
  const channel = await canAccessChannel(user, param(req, "id"));
  if (!channel) throw notFound("Channel not found.");
  if (channel.type === "DM") {
    const deletedPerson = await prisma.channelMember.findFirst({ where: { channelId: channel.id, user: { isSystem: true } } });
    if (deletedPerson) throw badRequest("This person's account was deleted, so you can't send them messages anymore.");
  }
  const body = parse(sendSchema, req.body);
  const content = body.content.trim();
  if (!content && body.attachmentIds.length === 0) throw badRequest("Write a message or attach a file.");

  if (body.replyToId) {
    const target = await prisma.message.findFirst({ where: { id: body.replyToId, channelId: channel.id } });
    if (!target) throw badRequest("The message you're replying to no longer exists.");
  }

  // Work out who this message mentions: people named directly and, with permission, everyone who can see the channel.
  const mentions = chatMentions(content, await channelAudience(channel.id), user.id, can(user, "mentions.everyone") && channel.type !== "DM");

  const created = await prisma.message.create({
    data: {
      channelId: channel.id,
      authorId: user.id,
      content,
      replyToId: body.replyToId ?? null,
      mentionsEveryone: mentions.everyone,
      mentions: {
        create: [
          ...mentions.named.map((userId) => ({ userId, byId: user.id, channelId: channel.id, everyone: false })),
          ...mentions.everyoneIds.map((userId) => ({ userId, byId: user.id, channelId: channel.id, everyone: true })),
        ],
      },
    },
  });

  if (body.attachmentIds.length) {
    await prisma.attachment.updateMany({
      where: { id: { in: body.attachmentIds }, uploaderId: user.id, messageId: null },
      data: { messageId: created.id },
    });
  }
  await prisma.channelMember.upsert({
    where: { channelId_userId: { channelId: channel.id, userId: user.id } },
    create: { channelId: channel.id, userId: user.id },
    update: { lastReadAt: new Date() },
  });

  const shaped = shapeMessage(await loadMessage(created.id));
  emitToChannel(channel.id, "message:new", shaped);
  notifyMentioned([...mentions.named, ...mentions.everyoneIds], user.displayName, channel, mentions.everyone);
  res.status(201).json(shaped);
});

/** Tells each mentioned person live, so their dashboard and notifications update straight away. */
function notifyMentioned(userIds: string[], byName: string, channel: { id: string; name: string; type: string }, everyone: boolean) {
  if (userIds.length === 0) return;
  emitToUsers(userIds, "mention:new", {
    kind: "message",
    by: byName,
    channelId: channel.id,
    where: channel.type === "DM" ? "a direct message" : `#${channel.name}`,
    everyone,
  });
}

async function accessibleMessage(req: { user?: import("../auth.js").AuthUser }, id: string) {
  const msg = await prisma.message.findUnique({ where: { id } });
  if (!msg) throw notFound("Message not found.");
  if (!(await canAccessChannel(req.user!, msg.channelId))) throw notFound("Message not found.");
  return msg;
}

async function broadcastUpdate(id: string) {
  const shaped = shapeMessage(await loadMessage(id));
  emitToChannel(shaped.channelId, "message:update", shaped);
  return shaped;
}

chatRouter.patch("/messages/:id", async (req, res) => {
  const msg = await accessibleMessage(req, param(req, "id"));
  if (msg.authorId !== req.user!.id) throw forbidden("You can only edit your own messages.");
  if (msg.deletedAt) throw badRequest("That message was deleted.");
  const { content } = parse(z.object({ content: z.string().trim().min(1).max(4000) }), req.body);

  // Editing can add new mentions; people who were already mentioned aren't notified a second time.
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: msg.channelId }, select: { id: true, name: true, type: true } });
  const found = chatMentions(content, await channelAudience(channel.id), req.user!.id, can(req.user!, "mentions.everyone") && channel.type !== "DM");
  const already = new Set((await prisma.mention.findMany({ where: { messageId: msg.id }, select: { userId: true } })).map((m) => m.userId));
  const fresh = [
    ...found.named.map((userId) => ({ userId, everyone: false })),
    ...found.everyoneIds.map((userId) => ({ userId, everyone: true })),
  ].filter((m) => !already.has(m.userId));

  await prisma.$transaction([
    prisma.message.update({
      where: { id: msg.id },
      data: { content, editedAt: new Date(), mentionsEveryone: msg.mentionsEveryone || found.everyone },
    }),
    prisma.mention.createMany({
      data: fresh.map((m) => ({ userId: m.userId, byId: req.user!.id, messageId: msg.id, channelId: msg.channelId, everyone: m.everyone })),
      skipDuplicates: true,
    }),
  ]);
  notifyMentioned(fresh.map((m) => m.userId), req.user!.displayName, channel, found.everyone);
  res.json(await broadcastUpdate(msg.id));
});

chatRouter.delete("/messages/:id", async (req, res) => {
  const msg = await accessibleMessage(req, param(req, "id"));
  if (msg.authorId !== req.user!.id && !can(req.user!, "messages.moderate")) {
    throw forbidden("You can only delete your own messages.");
  }
  await prisma.$transaction([
    prisma.message.update({ where: { id: msg.id }, data: { deletedAt: new Date(), content: "", pinned: false } }),
    // Free the database space the attached files were using.
    prisma.attachment.deleteMany({ where: { messageId: msg.id } }),
  ]);
  emitToChannel(msg.channelId, "message:delete", { id: msg.id, channelId: msg.channelId });
  res.json({ ok: true });
});

chatRouter.post("/messages/:id/pin", requirePerm("messages.moderate"), async (req, res) => {
  const msg = await accessibleMessage(req, param(req, "id"));
  if (msg.deletedAt) throw badRequest("That message was deleted.");
  await prisma.message.update({ where: { id: msg.id }, data: { pinned: !msg.pinned } });
  res.json(await broadcastUpdate(msg.id));
});

chatRouter.post("/messages/:id/reactions", requirePerm("messages.send"), async (req, res) => {
  const msg = await accessibleMessage(req, param(req, "id"));
  if (msg.deletedAt) throw badRequest("That message was deleted.");
  const { emoji } = parse(z.object({ emoji: z.string().min(1).max(16) }), req.body);
  const key = { messageId_userId_emoji: { messageId: msg.id, userId: req.user!.id, emoji } };
  const existing = await prisma.reaction.findUnique({ where: key });
  if (existing) await prisma.reaction.delete({ where: key });
  else {
    const kinds = await prisma.reaction.groupBy({ by: ["emoji"], where: { messageId: msg.id } });
    if (kinds.length >= 20 && !kinds.some((k) => k.emoji === emoji)) throw badRequest("Too many different reactions.");
    await prisma.reaction.create({ data: { messageId: msg.id, userId: req.user!.id, emoji } });
  }
  res.json(await broadcastUpdate(msg.id));
});

chatRouter.get("/search/messages", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) return void res.json([]);
  const rows = await prisma.message.findMany({
    where: {
      deletedAt: null,
      content: { contains: q, mode: "insensitive" },
      channel: visibleChannelWhere(req.user!),
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { ...messageInclude, channel: { select: { id: true, name: true, type: true } } },
  });
  res.json(rows.map((r) => ({ ...shapeMessage(r), channel: r.channel })));
});
