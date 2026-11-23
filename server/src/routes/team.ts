import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { can, requirePerm } from "../auth.js";
import { prisma } from "../db.js";
import { badRequest, forbidden, HttpError, notFound, param, parse } from "../lib/http.js";
import { AVATAR_COLORS, memberDetailSelect, publicUserSelect } from "../lib/serialize.js";
import { ALL_PERMISSION_KEYS, PERMISSION_CATALOG } from "../permissions.js";
import { emitAll, onlineUserIds } from "../realtime.js";

export const teamRouter = Router();

// ─── Members ─────────────────────────────────────────────────────────────

teamRouter.get("/users", async (req, res) => {
  const manager = can(req.user!, "members.manage");
  const users = await prisma.user.findMany({
    where: manager ? {} : { status: "ACTIVE" },
    select: manager ? memberDetailSelect : publicUserSelect,
    orderBy: { displayName: "asc" },
  });
  res.json({ users, online: onlineUserIds() });
});

const memberPatch = z.object({
  roleIds: z.array(z.string()).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  jobTitle: z.string().trim().max(80).nullable().optional(),
  displayName: z.string().trim().min(1).max(60).optional(),
});

teamRouter.patch("/users/:id", requirePerm("members.manage"), async (req, res) => {
  const actor = req.user!;
  const target = await prisma.user.findUnique({ where: { id: param(req, "id") } });
  if (!target) throw notFound("Member not found.");
  const body = parse(memberPatch, req.body);

  if (target.isOwner && !actor.isOwner) throw forbidden("Only the workspace owner can change the owner's account.");
  if (body.status === "DISABLED" && target.id === actor.id) throw badRequest("You cannot disable your own account.");

  if (body.roleIds) {
    const roles = await prisma.role.findMany({ where: { id: { in: body.roleIds } } });
    if (roles.length !== new Set(body.roleIds).size) throw badRequest("Unknown role.");
    const grantsAdmin = roles.some((r) => r.permissions.includes("admin"));
    if (grantsAdmin && !actor.perms.has("admin")) throw forbidden("Only administrators can assign administrator roles.");
    const hadAdminRole = await prisma.role.count({
      where: { users: { some: { id: target.id } }, permissions: { has: "admin" } },
    });
    if (hadAdminRole && !actor.perms.has("admin")) throw forbidden("Only administrators can change an administrator's roles.");
  }

  const { roleIds, ...rest } = body;
  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { ...rest, ...(roleIds ? { roles: { set: roleIds.map((id) => ({ id })) } } : {}) },
    select: memberDetailSelect,
  });
  emitAll("users:changed", { id: target.id });
  res.json(updated);
});

// ─── Accounts created by an admin ────────────────────────────────────────

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.-]{3,24}$/, "Username must be 3-24 letters, numbers, dots, dashes or underscores."),
  displayName: z.string().trim().min(1, "Display name is required.").max(60),
  // Optional: a username is enough to have an account.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address."))
    .optional()
    .or(z.literal("").transform(() => undefined)),
  jobTitle: z.string().trim().max(80).nullable().optional(),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  roleIds: z.array(z.string()).default([]),
});

teamRouter.post("/users", requirePerm("members.manage"), async (req, res) => {
  const actor = req.user!;
  const body = parse(createUserSchema, req.body);

  const clash = await prisma.user.findFirst({
    // Only compare emails when one was given: an undefined filter inside OR would match every row.
    where: { OR: [...(body.email ? [{ email: body.email }] : []), { username: body.username }] },
    select: { email: true },
  });
  if (clash) {
    throw new HttpError(409, body.email && clash.email === body.email ? "That email is already registered." : "That username is taken.");
  }

  let roleIds = body.roleIds;
  if (roleIds.length) {
    const roles = await prisma.role.findMany({ where: { id: { in: roleIds } } });
    if (roles.length !== new Set(roleIds).size) throw badRequest("Unknown role.");
    if (roles.some((r) => r.permissions.includes("admin")) && !actor.perms.has("admin")) {
      throw forbidden("Only administrators can create administrator accounts.");
    }
  } else {
    const fallback = await prisma.role.findFirst({ where: { isDefault: true } });
    roleIds = fallback ? [fallback.id] : [];
  }

  const user = await prisma.user.create({
    data: {
      username: body.username,
      displayName: body.displayName,
      email: body.email ?? null,
      jobTitle: body.jobTitle ?? null,
      passwordHash: await bcrypt.hash(body.password, 12),
      // The admin chose this password, so the member must replace it the first time they sign in.
      mustChangePassword: true,
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!,
      roles: { connect: roleIds.map((id) => ({ id })) },
    },
    select: memberDetailSelect,
  });
  emitAll("users:changed", { id: user.id });
  res.status(201).json(user);
});

teamRouter.post("/users/:id/password", requirePerm("members.manage"), async (req, res) => {
  const actor = req.user!;
  const target = await prisma.user.findUnique({
    where: { id: param(req, "id") },
    include: { roles: { select: { permissions: true } } },
  });
  if (!target) throw notFound("Member not found.");
  if (target.id === actor.id) throw badRequest("Change your own password from your profile.");
  if (target.isOwner && !actor.isOwner) throw forbidden("Only the workspace owner can reset the owner's password.");
  if (target.roles.some((r) => r.permissions.includes("admin")) && !actor.perms.has("admin")) {
    throw forbidden("Only administrators can reset an administrator's password.");
  }
  const { password } = parse(z.object({ password: z.string().min(8, "Password must be at least 8 characters.").max(200) }), req.body);
  await prisma.user.update({
    where: { id: target.id },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      mustChangePassword: true,
      // Signs the member out everywhere; they come back in with the new temporary password.
      sessionsValidFrom: new Date(),
    },
  });
  res.json({ ok: true });
});

// ─── Profile photos ──────────────────────────────────────────────────────

teamRouter.get("/avatars/:id", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: param(req, "id") },
    select: { avatar: true, avatarType: true },
  });
  if (!user?.avatar || !user.avatarType) throw notFound("No photo.");
  res.setHeader("Content-Type", user.avatarType);
  res.setHeader("Content-Length", String(user.avatar.byteLength));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  // The URL carries the upload time (?v=), so a new photo always gets a new URL.
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.end(Buffer.from(user.avatar));
});

// ─── Roles ───────────────────────────────────────────────────────────────

teamRouter.get("/permissions", (_req, res) => {
  res.json(PERMISSION_CATALOG);
});

teamRouter.get("/roles", async (_req, res) => {
  const roles = await prisma.role.findMany({
    orderBy: { position: "desc" },
    include: { _count: { select: { users: true } } },
  });
  res.json(roles);
});

const roleSchema = z.object({
  name: z.string().trim().min(1, "Role name is required.").max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#99aab5"),
  permissions: z.array(z.string()).default([]),
  position: z.number().int().min(0).max(1000).default(20),
  isDefault: z.boolean().default(false),
});

function checkRolePermissions(actorIsAdmin: boolean, permissions: string[]) {
  for (const p of permissions) if (!ALL_PERMISSION_KEYS.has(p)) throw badRequest(`Unknown permission "${p}".`);
  if (permissions.includes("admin") && !actorIsAdmin) throw forbidden("Only administrators can grant the administrator permission.");
}

teamRouter.post("/roles", requirePerm("roles.manage"), async (req, res) => {
  const body = parse(roleSchema, req.body);
  checkRolePermissions(req.user!.perms.has("admin"), body.permissions);
  if (await prisma.role.findUnique({ where: { name: body.name } })) throw badRequest("A role with that name already exists.");
  if (body.isDefault) await prisma.role.updateMany({ data: { isDefault: false } });
  res.status(201).json(await prisma.role.create({ data: body }));
});

teamRouter.patch("/roles/:id", requirePerm("roles.manage"), async (req, res) => {
  const role = await prisma.role.findUnique({ where: { id: param(req, "id") } });
  if (!role) throw notFound("Role not found.");
  const body = parse(roleSchema.partial(), req.body);
  const actorIsAdmin = req.user!.perms.has("admin");
  if (body.permissions) checkRolePermissions(actorIsAdmin, body.permissions);
  if (role.permissions.includes("admin") && !actorIsAdmin) throw forbidden("Only administrators can edit an administrator role.");
  if (body.name && body.name !== role.name && (await prisma.role.findUnique({ where: { name: body.name } }))) {
    throw badRequest("A role with that name already exists.");
  }
  if (body.isDefault) await prisma.role.updateMany({ data: { isDefault: false } });
  const updated = await prisma.role.update({ where: { id: role.id }, data: body });
  emitAll("users:changed", {});
  res.json(updated);
});

teamRouter.delete("/roles/:id", requirePerm("roles.manage"), async (req, res) => {
  const role = await prisma.role.findUnique({ where: { id: param(req, "id") } });
  if (!role) throw notFound("Role not found.");
  if (role.isSystem) throw badRequest("The built-in Admin role cannot be deleted.");
  if (role.isDefault) throw badRequest("Pick a different default role before deleting this one.");
  if (role.permissions.includes("admin") && !req.user!.perms.has("admin")) throw forbidden();
  await prisma.role.delete({ where: { id: role.id } });
  emitAll("users:changed", {});
  res.json({ ok: true });
});

// ─── Invites ─────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()).optional().or(z.literal("").transform(() => undefined)),
  roleId: z.string().nullable().optional(),
  maxUses: z.number().int().min(1).max(100).default(1),
  expiresInDays: z.number().int().min(1).max(90).nullable().optional(),
});

teamRouter.get("/invites", requirePerm("invites.manage"), async (_req, res) => {
  res.json(
    await prisma.invite.findMany({
      orderBy: { createdAt: "desc" },
      include: { role: { select: { id: true, name: true, color: true } }, createdBy: { select: { displayName: true } } },
    }),
  );
});

teamRouter.post("/invites", requirePerm("invites.manage"), async (req, res) => {
  const body = parse(inviteSchema, req.body);
  if (body.roleId) {
    const role = await prisma.role.findUnique({ where: { id: body.roleId } });
    if (!role) throw badRequest("Unknown role.");
    if (role.permissions.includes("admin") && !req.user!.perms.has("admin")) {
      throw forbidden("Only administrators can invite people as administrators.");
    }
  }
  const invite = await prisma.invite.create({
    data: {
      code: crypto.randomBytes(8).toString("base64url"),
      email: body.email ?? null,
      roleId: body.roleId ?? null,
      maxUses: body.maxUses,
      expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
      createdById: req.user!.id,
    },
    include: { role: { select: { id: true, name: true, color: true } }, createdBy: { select: { displayName: true } } },
  });
  res.status(201).json(invite);
});

teamRouter.delete("/invites/:id", requirePerm("invites.manage"), async (req, res) => {
  await prisma.invite.deleteMany({ where: { id: param(req, "id") } });
  res.json({ ok: true });
});
