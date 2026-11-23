import { Router } from "express";
import { z } from "zod";
import { can, requirePerm } from "../auth.js";
import { prisma } from "../db.js";
import { badRequest, forbidden, notFound, param, parse, slugify } from "../lib/http.js";
import { miniUserSelect } from "../lib/serialize.js";
import { emitAll, emitToUsers } from "../realtime.js";

export const workRouter = Router();

const date = z.coerce.date();
const optDate = z.coerce.date().nullable().optional();

// ─── Productions ─────────────────────────────────────────────────────────

const PRODUCTION_STATUS = ["DEVELOPMENT", "PRE_PRODUCTION", "PRODUCTION", "POST_PRODUCTION", "DELIVERED", "ARCHIVED"] as const;

const productionSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(120),
  client: z.string().trim().max(120).nullable().optional(),
  kind: z.string().trim().max(40).default("Other"),
  status: z.enum(PRODUCTION_STATUS).default("DEVELOPMENT"),
  description: z.string().trim().max(4000).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  budget: z.number().int().min(0).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#5865f2"),
  startDate: optDate,
  endDate: optDate,
  deliveryDate: optDate,
  memberIds: z.array(z.string()).default([]),
});

const productionInclude = {
  members: { include: { user: { select: miniUserSelect } } },
  channels: { select: { id: true, name: true } },
  _count: { select: { tasks: true, documents: true, events: true } },
} as const;

function shapeProduction<T extends { budget: number | null }>(p: T, user: Express.Request["user"]) {
  const showBudget = can(user!, "productions.manage", "documents.sensitive");
  return showBudget ? p : { ...p, budget: null };
}

async function assertCanEditProduction(user: NonNullable<Express.Request["user"]>, id: string) {
  const production = await prisma.production.findUnique({ where: { id } });
  if (!production) throw notFound("Production not found.");
  if (!can(user, "productions.manage") && production.createdById !== user.id) {
    throw forbidden("Only the production's creator or a manager can change it.");
  }
  return production;
}

workRouter.get("/productions", async (req, res) => {
  const rows = await prisma.production.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: productionInclude,
  });
  res.json(rows.map((p) => shapeProduction(p, req.user)));
});

workRouter.get("/productions/:id", async (req, res) => {
  const p = await prisma.production.findUnique({ where: { id: param(req, "id") }, include: productionInclude });
  if (!p) throw notFound("Production not found.");
  res.json(shapeProduction(p, req.user));
});

workRouter.post("/productions", requirePerm("productions.create"), async (req, res) => {
  const { memberIds, ...body } = parse(productionSchema, req.body);
  const members = [...new Set([req.user!.id, ...memberIds])];
  const production = await prisma.production.create({
    data: {
      ...body,
      createdById: req.user!.id,
      members: { create: members.map((userId) => ({ userId })) },
      channels: {
        create: { name: slugify(body.title), topic: `Chat for ${body.title}`, category: "Productions" },
      },
    },
    include: productionInclude,
  });
  emitAll("channels:changed", {});
  emitAll("productions:changed", {});
  res.status(201).json(shapeProduction(production, req.user));
});

workRouter.patch("/productions/:id", async (req, res) => {
  const existing = await assertCanEditProduction(req.user!, param(req, "id"));
  const { memberIds: _ignored, ...body } = parse(productionSchema.partial(), req.body);
  const updated = await prisma.production.update({
    where: { id: existing.id },
    data: body,
    include: productionInclude,
  });
  emitAll("productions:changed", {});
  res.json(shapeProduction(updated, req.user));
});

workRouter.delete("/productions/:id", async (req, res) => {
  const existing = await assertCanEditProduction(req.user!, param(req, "id"));
  await prisma.production.delete({ where: { id: existing.id } });
  emitAll("channels:changed", {});
  emitAll("productions:changed", {});
  res.json({ ok: true });
});

workRouter.post("/productions/:id/members", async (req, res) => {
  const existing = await assertCanEditProduction(req.user!, param(req, "id"));
  const body = parse(z.object({ userId: z.string(), jobTitle: z.string().trim().max(80).nullable().optional() }), req.body);
  if (!(await prisma.user.findFirst({ where: { id: body.userId, status: "ACTIVE" } }))) throw badRequest("Unknown member.");
  await prisma.productionMember.upsert({
    where: { productionId_userId: { productionId: existing.id, userId: body.userId } },
    create: { productionId: existing.id, userId: body.userId, jobTitle: body.jobTitle ?? null },
    update: { jobTitle: body.jobTitle ?? null },
  });
  emitAll("productions:changed", {});
  res.json({ ok: true });
});

workRouter.delete("/productions/:id/members/:userId", async (req, res) => {
  const existing = await assertCanEditProduction(req.user!, param(req, "id"));
  await prisma.productionMember.deleteMany({ where: { productionId: existing.id, userId: param(req, "userId") } });
  emitAll("productions:changed", {});
  res.json({ ok: true });
});

// ─── Tasks ───────────────────────────────────────────────────────────────

const taskInclude = {
  assignee: { select: miniUserSelect },
  createdBy: { select: miniUserSelect },
  production: { select: { id: true, title: true, color: true } },
} as const;

const taskSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]).default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: optDate,
  productionId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
});

workRouter.get("/tasks", async (req, res) => {
  const q = req.query;
  const rows = await prisma.task.findMany({
    where: {
      ...(typeof q.productionId === "string" ? { productionId: q.productionId } : {}),
      ...(q.mine === "1" ? { assigneeId: req.user!.id } : {}),
      ...(typeof q.assigneeId === "string" ? { assigneeId: q.assigneeId } : {}),
    },
    orderBy: [{ status: "asc" }, { position: "asc" }, { createdAt: "desc" }],
    include: taskInclude,
  });
  res.json(rows);
});

workRouter.post("/tasks", requirePerm("tasks.manage"), async (req, res) => {
  const body = parse(taskSchema, req.body);
  const task = await prisma.task.create({ data: { ...body, createdById: req.user!.id }, include: taskInclude });
  if (task.assigneeId && task.assigneeId !== req.user!.id) {
    emitToUsers([task.assigneeId], "notify", { kind: "task", text: `${req.user!.displayName} assigned you "${task.title}"` });
  }
  emitAll("tasks:changed", {});
  res.status(201).json(task);
});

workRouter.patch("/tasks/:id", async (req, res) => {
  const user = req.user!;
  const task = await prisma.task.findUnique({ where: { id: param(req, "id") } });
  if (!task) throw notFound("Task not found.");
  const manager = can(user, "tasks.manage");
  const mine = task.assigneeId === user.id || task.createdById === user.id;
  if (!manager && !mine) throw forbidden();

  const body = parse(taskSchema.partial(), req.body);
  // People who only own the task may move it along, not rewrite it.
  const data = manager ? body : { status: body.status };
  const updated = await prisma.task.update({ where: { id: task.id }, data, include: taskInclude });
  if (manager && body.assigneeId && body.assigneeId !== task.assigneeId && body.assigneeId !== user.id) {
    emitToUsers([body.assigneeId], "notify", { kind: "task", text: `${user.displayName} assigned you "${updated.title}"` });
  }
  emitAll("tasks:changed", {});
  res.json(updated);
});

workRouter.delete("/tasks/:id", requirePerm("tasks.manage"), async (req, res) => {
  await prisma.task.deleteMany({ where: { id: param(req, "id") } });
  emitAll("tasks:changed", {});
  res.json({ ok: true });
});

// ─── Calendar ────────────────────────────────────────────────────────────

const eventInclude = {
  attendees: { include: { user: { select: miniUserSelect } } },
  production: { select: { id: true, title: true, color: true } },
  createdBy: { select: miniUserSelect },
} as const;

const eventSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200),
    description: z.string().trim().max(4000).nullable().optional(),
    type: z.enum(["SHOOT", "MEETING", "SCOUT", "REVIEW", "DEADLINE", "DELIVERY", "OTHER"]).default("OTHER"),
    start: date,
    end: date,
    allDay: z.boolean().default(false),
    location: z.string().trim().max(200).nullable().optional(),
    productionId: z.string().nullable().optional(),
    attendeeIds: z.array(z.string()).default([]),
  })
  .refine((e) => e.end >= e.start, { message: "End must be after start.", path: ["end"] });

workRouter.get("/events", async (req, res) => {
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  const rows = await prisma.event.findMany({
    where: {
      ...(from && !isNaN(+from) ? { end: { gte: from } } : {}),
      ...(to && !isNaN(+to) ? { start: { lte: to } } : {}),
      ...(typeof req.query.productionId === "string" ? { productionId: req.query.productionId } : {}),
    },
    orderBy: { start: "asc" },
    include: eventInclude,
  });
  res.json(rows);
});

workRouter.post("/events", requirePerm("events.manage"), async (req, res) => {
  const { attendeeIds, ...body } = parse(eventSchema, req.body);
  const event = await prisma.event.create({
    data: {
      ...body,
      createdById: req.user!.id,
      attendees: { create: [...new Set(attendeeIds)].map((userId) => ({ userId })) },
    },
    include: eventInclude,
  });
  emitToUsers(attendeeIds.filter((id) => id !== req.user!.id), "notify", {
    kind: "event",
    text: `${req.user!.displayName} added you to "${event.title}"`,
  });
  emitAll("events:changed", {});
  res.status(201).json(event);
});

workRouter.patch("/events/:id", requirePerm("events.manage"), async (req, res) => {
  const existing = await prisma.event.findUnique({ where: { id: param(req, "id") }, include: { attendees: true } });
  if (!existing) throw notFound("Event not found.");
  const parsed = parse(
    z.object({
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(4000).nullable(),
      type: z.enum(["SHOOT", "MEETING", "SCOUT", "REVIEW", "DEADLINE", "DELIVERY", "OTHER"]),
      start: date,
      end: date,
      allDay: z.boolean(),
      location: z.string().trim().max(200).nullable(),
      productionId: z.string().nullable(),
      attendeeIds: z.array(z.string()),
    }).partial(),
    req.body,
  );
  const { attendeeIds, ...rest } = parsed;
  const start = rest.start ?? existing.start;
  const end = rest.end ?? existing.end;
  if (end < start) throw badRequest("End must be after start.");

  if (attendeeIds) {
    const keep = new Set(attendeeIds);
    await prisma.eventAttendee.deleteMany({ where: { eventId: existing.id, userId: { notIn: [...keep] } } });
    const have = new Set(existing.attendees.map((a) => a.userId));
    const add = [...keep].filter((id) => !have.has(id));
    if (add.length) await prisma.eventAttendee.createMany({ data: add.map((userId) => ({ eventId: existing.id, userId })) });
  }
  const updated = await prisma.event.update({ where: { id: existing.id }, data: rest, include: eventInclude });
  emitAll("events:changed", {});
  res.json(updated);
});

workRouter.delete("/events/:id", requirePerm("events.manage"), async (req, res) => {
  await prisma.event.deleteMany({ where: { id: param(req, "id") } });
  emitAll("events:changed", {});
  res.json({ ok: true });
});

workRouter.post("/events/:id/rsvp", async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["ACCEPTED", "DECLINED", "PENDING"]) }), req.body);
  const result = await prisma.eventAttendee.updateMany({
    where: { eventId: param(req, "id"), userId: req.user!.id },
    data: { status },
  });
  if (result.count === 0) throw forbidden("You are not on this event's attendee list.");
  emitAll("events:changed", {});
  res.json({ ok: true });
});

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d: Date, allDay: boolean) =>
  allDay ? d.toISOString().slice(0, 10).replace(/-/g, "") : d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

workRouter.get("/calendar.ics", async (_req, res) => {
  const events = await prisma.event.findMany({ orderBy: { start: "asc" }, include: { production: { select: { title: true } } } });
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tony Prod//Production Calendar//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@tony-prod`,
      `DTSTAMP:${icsDate(e.createdAt, false)}`,
      e.allDay ? `DTSTART;VALUE=DATE:${icsDate(e.start, true)}` : `DTSTART:${icsDate(e.start, false)}`,
      e.allDay ? `DTEND;VALUE=DATE:${icsDate(new Date(+e.end + 86_400_000), true)}` : `DTEND:${icsDate(e.end, false)}`,
      `SUMMARY:${icsEscape(e.production ? `[${e.production.title}] ${e.title}` : e.title)}`,
      ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
      `CATEGORIES:${e.type}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="production-calendar.ics"');
  res.send(lines.join("\r\n"));
});

// ─── Announcements ───────────────────────────────────────────────────────

const announcementSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(160),
  body: z.string().trim().min(1, "Write something to announce.").max(10000),
  priority: z.enum(["NORMAL", "IMPORTANT", "URGENT"]).default("NORMAL"),
  pinned: z.boolean().default(false),
  productionId: z.string().nullable().optional(),
});

workRouter.get("/announcements", async (req, res) => {
  const rows = await prisma.announcement.findMany({
    where: typeof req.query.productionId === "string" ? { productionId: req.query.productionId } : {},
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      author: { select: miniUserSelect },
      production: { select: { id: true, title: true, color: true } },
      reads: { select: { userId: true } },
    },
  });
  res.json(
    rows.map(({ reads, ...a }) => ({
      ...a,
      read: reads.some((r) => r.userId === req.user!.id),
      readCount: reads.length,
    })),
  );
});

workRouter.post("/announcements", requirePerm("announcements.post"), async (req, res) => {
  const body = parse(announcementSchema, req.body);
  const created = await prisma.announcement.create({
    data: { ...body, authorId: req.user!.id },
    include: { author: { select: miniUserSelect } },
  });
  await prisma.announcementRead.create({ data: { announcementId: created.id, userId: req.user!.id } });
  emitAll("announcement:new", {
    id: created.id,
    title: created.title,
    priority: created.priority,
    author: created.author.displayName,
    authorId: created.authorId,
  });
  res.status(201).json(created);
});

workRouter.patch("/announcements/:id", requirePerm("announcements.post"), async (req, res) => {
  const body = parse(announcementSchema.partial(), req.body);
  const updated = await prisma.announcement.update({ where: { id: param(req, "id") }, data: body });
  emitAll("announcements:changed", {});
  res.json(updated);
});

workRouter.delete("/announcements/:id", requirePerm("announcements.post"), async (req, res) => {
  await prisma.announcement.deleteMany({ where: { id: param(req, "id") } });
  emitAll("announcements:changed", {});
  res.json({ ok: true });
});

workRouter.post("/announcements/:id/read", async (req, res) => {
  const announcementId = param(req, "id");
  if (!(await prisma.announcement.findUnique({ where: { id: announcementId }, select: { id: true } }))) {
    throw notFound("Announcement not found.");
  }
  await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId, userId: req.user!.id } },
    create: { announcementId, userId: req.user!.id },
    update: {},
  });
  res.json({ ok: true });
});

workRouter.get("/announcements/:id/reads", requirePerm("announcements.post"), async (req, res) => {
  const reads = await prisma.announcementRead.findMany({
    where: { announcementId: param(req, "id") },
    include: { user: { select: miniUserSelect } },
    orderBy: { readAt: "asc" },
  });
  res.json(reads.map((r) => ({ ...r.user, readAt: r.readAt })));
});

// ─── Dashboard ───────────────────────────────────────────────────────────

workRouter.get("/dashboard", async (req, res) => {
  const user = req.user!;
  const now = new Date();
  const inTwoWeeks = new Date(+now + 14 * 86_400_000);
  const [events, tasks, announcements, productions, unreadAnnouncements] = await Promise.all([
    prisma.event.findMany({
      where: { end: { gte: now }, start: { lte: inTwoWeeks } },
      orderBy: { start: "asc" },
      take: 8,
      include: { production: { select: { id: true, title: true, color: true } } },
    }),
    prisma.task.findMany({
      where: { assigneeId: user.id, status: { not: "DONE" } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
      take: 8,
      include: { production: { select: { id: true, title: true, color: true } } },
    }),
    prisma.announcement.findMany({
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 4,
      include: { author: { select: miniUserSelect } },
    }),
    prisma.production.count({ where: { status: { in: ["PRE_PRODUCTION", "PRODUCTION", "POST_PRODUCTION"] } } }),
    prisma.announcement.count({ where: { reads: { none: { userId: user.id } } } }),
  ]);
  res.json({ events, tasks, announcements, activeProductions: productions, unreadAnnouncements });
});
