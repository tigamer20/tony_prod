import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { can, requirePerm } from "../auth.js";
import { prisma } from "../db.js";
import { badRequest, forbidden, notFound, param, parse } from "../lib/http.js";
import { memberDetailSelect, publicUserSelect } from "../lib/serialize.js";
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
