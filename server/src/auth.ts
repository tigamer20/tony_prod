import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { forbidden, HttpError } from "./lib/http.js";
import { permissionsFor } from "./permissions.js";

export const COOKIE_NAME = "tp_session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  isOwner: boolean;
  roleIds: string[];
  perms: Set<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "30d" });
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export interface TokenInfo {
  sub: string;
  /** Issued-at, in seconds. */
  iat: number;
}

export function verifyToken(token: string | undefined): TokenInfo | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub?: string; iat?: number };
    return payload.sub ? { sub: payload.sub, iat: payload.iat ?? 0 } : null;
  } catch {
    return null;
  }
}

/** Loads the signed-in user. Pass the token's issue time to reject sessions older than a password change. */
export async function loadAuthUser(userId: string, issuedAt?: number): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { select: { id: true, permissions: true } } },
  });
  if (!user || user.status !== "ACTIVE") return null;
  if (issuedAt !== undefined && user.sessionsValidFrom && issuedAt < Math.floor(user.sessionsValidFrom.getTime() / 1000)) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    isOwner: user.isOwner,
    roleIds: user.roles.map((r) => r.id),
    perms: permissionsFor(user),
  };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = verifyToken(req.cookies?.[COOKIE_NAME]);
  if (!token) return next(new HttpError(401, "Please sign in."));
  const user = await loadAuthUser(token.sub, token.iat);
  if (!user) return next(new HttpError(401, "Please sign in."));
  req.user = user;
  next();
}

/** Allows the request if the user holds ANY of the given permissions. */
export function requirePerm(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const perms = req.user!.perms;
    if (keys.some((k) => perms.has(k))) return next();
    next(forbidden());
  };
}

export const can = (user: AuthUser, ...keys: string[]) => keys.some((k) => user.perms.has(k));
