import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  clearSessionCookie,
  loadAuthUser,
  requireAuth,
  setSessionCookie,
  signToken,
} from "../auth.js";
import { prisma } from "../db.js";
import { badRequest, HttpError, parse } from "../lib/http.js";
import { memberDetailSelect } from "../lib/serialize.js";

export const authRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

const AVATAR_COLORS = ["#5865f2", "#eb459e", "#3ba55d", "#f0b232", "#ed4245", "#1abc9c", "#9b59b6", "#e67e22"];

async function mePayload(userId: string) {
  const [user, auth] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: memberDetailSelect }),
    loadAuthUser(userId),
  ]);
  return { user, permissions: [...(auth?.perms ?? [])] };
}

authRouter.get("/setup", async (_req, res) => {
  res.json({ needsSetup: (await prisma.user.count()) === 0 });
});

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.-]{3,24}$/, "Username must be 3-24 letters, numbers, dots, dashes or underscores."),
  displayName: z.string().trim().min(1, "Display name is required.").max(60),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  inviteCode: z.string().trim().optional(),
});

authRouter.post("/register", limiter, async (req, res) => {
  const body = parse(registerSchema, req.body);
  const isFirstUser = (await prisma.user.count()) === 0;

  let invite = null;
  if (!isFirstUser) {
    if (!body.inviteCode) throw badRequest("An invite code is required to create an account.");
    invite = await prisma.invite.findUnique({ where: { code: body.inviteCode } });
    const invalid =
      !invite ||
      invite.uses >= invite.maxUses ||
      (invite.expiresAt && invite.expiresAt < new Date()) ||
      (invite.email && invite.email.toLowerCase() !== body.email);
    if (invalid) throw badRequest("That invite code is invalid, expired or already used.");
  }

  const clash = await prisma.user.findFirst({
    where: { OR: [{ email: body.email }, { username: body.username }] },
    select: { email: true },
  });
  if (clash) {
    throw new HttpError(409, clash.email === body.email ? "That email is already registered." : "That username is taken.");
  }

  if (invite) {
    const claimed = await prisma.invite.updateMany({
      where: { id: invite.id, uses: { lt: invite.maxUses } },
      data: { uses: { increment: 1 } },
    });
    if (claimed.count !== 1) throw badRequest("That invite code is invalid, expired or already used.");
  }

  let roleIds: string[] = [];
  if (isFirstUser) {
    const admin = await prisma.role.findUnique({ where: { name: "Admin" } });
    if (admin) roleIds = [admin.id];
  } else if (invite?.roleId) {
    roleIds = [invite.roleId];
  } else {
    const def = await prisma.role.findFirst({ where: { isDefault: true } });
    if (def) roleIds = [def.id];
  }

  const user = await prisma.user.create({
    data: {
      email: body.email,
      username: body.username,
      displayName: body.displayName,
      passwordHash: await bcrypt.hash(body.password, 12),
      isOwner: isFirstUser,
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!,
      roles: { connect: roleIds.map((id) => ({ id })) },
    },
  });

  setSessionCookie(res, signToken(user.id));
  res.status(201).json(await mePayload(user.id));
});

const loginSchema = z.object({
  identifier: z.string().trim().toLowerCase().min(1, "Enter your email or username."),
  password: z.string().min(1, "Enter your password."),
});

authRouter.post("/login", limiter, async (req, res) => {
  const body = parse(loginSchema, req.body);
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: body.identifier }, { username: body.identifier }] },
  });
  const ok = user ? await bcrypt.compare(body.password, user.passwordHash) : false;
  if (!user || !ok) throw new HttpError(401, "Incorrect email/username or password.");
  if (user.status !== "ACTIVE") throw new HttpError(403, "This account has been disabled. Contact an administrator.");

  setSessionCookie(res, signToken(user.id));
  res.json(await mePayload(user.id));
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json(await mePayload(req.user!.id));
});

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  jobTitle: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

authRouter.patch("/me", requireAuth, async (req, res) => {
  const data = parse(profileSchema, req.body);
  await prisma.user.update({ where: { id: req.user!.id }, data });
  res.json(await mePayload(req.user!.id));
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters.").max(200),
});

authRouter.post("/password", requireAuth, limiter, async (req, res) => {
  const body = parse(passwordSchema, req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
    throw new HttpError(400, "Your current password is incorrect.");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(body.newPassword, 12) },
  });
  res.json({ ok: true });
});
