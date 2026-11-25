import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { emitAll } from "../realtime.js";
import {
  clearSessionCookie,
  loadAuthUser,
  requireAuth,
  setSessionCookie,
  signToken,
} from "../auth.js";
import { prisma } from "../db.js";
import { badRequest, HttpError, parse } from "../lib/http.js";
import { AVATAR_COLORS, memberDetailSelect } from "../lib/serialize.js";

export const authRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

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
  // Optional: a username is enough to have an account.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address."))
    .optional()
    .or(z.literal("").transform(() => undefined)),
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
    // Only compare emails when one was given: an undefined filter inside OR would match every row.
    where: { OR: [...(body.email ? [{ email: body.email }] : []), { username: body.username }] },
    select: { email: true },
  });
  if (clash) {
    throw new HttpError(409, body.email && clash.email === body.email ? "That email is already registered." : "That username is taken.");
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
      email: body.email ?? null,
      username: body.username,
      displayName: body.displayName,
      passwordHash: await bcrypt.hash(body.password, 12),
      isOwner: isFirstUser,
      // Signing up signs the person in, so they are not "pending".
      lastLoginAt: new Date(),
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

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  // Lets an open Team screen flip "Pending" to the sign-in time right away.
  emitAll("users:changed", { id: user.id });

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
  // Left out on the first sign-in: the member just typed the temporary password to get in.
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8, "New password must be at least 8 characters.").max(200),
});

authRouter.post("/password", requireAuth, limiter, async (req, res) => {
  const body = parse(passwordSchema, req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (user.mustChangePassword) {
    // First sign-in (or after a reset): they've already proven the temporary password by signing in, so don't ask again.
    if (await bcrypt.compare(body.newPassword, user.passwordHash)) throw new HttpError(400, "Choose a password different from the temporary one.");
  } else {
    if (!body.currentPassword || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      throw new HttpError(400, "Your current password is incorrect.");
    }
    if (body.currentPassword === body.newPassword) throw new HttpError(400, "Your new password must be different from the current one.");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(body.newPassword, 12),
      mustChangePassword: false,
      // Sign out every other device, then keep this one signed in with a fresh token.
      sessionsValidFrom: new Date(),
    },
  });
  setSessionCookie(res, signToken(user.id));
  res.json(await mePayload(user.id));
});

// ─── Profile photo ───────────────────────────────────────────────────────

const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } });

/** Identify an image by its first bytes rather than trusting the browser-supplied type. */
function sniffImage(b: Buffer): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (b.length > 6 && ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii"))) return "image/gif";
  return null;
}

authRouter.post("/avatar", requireAuth, avatarUpload.single("avatar"), async (req, res) => {
  if (!req.file) throw badRequest("Choose a photo to upload.");
  const type = sniffImage(req.file.buffer);
  if (!type) throw new HttpError(415, "Profile photos must be PNG, JPEG, WebP or GIF images.");
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { avatar: new Uint8Array(req.file.buffer), avatarType: type, avatarUpdatedAt: new Date() },
  });
  emitAll("users:changed", {});
  res.json(await mePayload(req.user!.id));
});

authRouter.delete("/avatar", requireAuth, async (req, res) => {
  await prisma.user.update({ where: { id: req.user!.id }, data: { avatar: null, avatarType: null, avatarUpdatedAt: null } });
  emitAll("users:changed", {});
  res.json(await mePayload(req.user!.id));
});
