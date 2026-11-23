import type { Prisma } from "@prisma/client";
import type { AuthUser } from "./auth.js";
import { prisma } from "./db.js";

/** Prisma filter describing every channel the user is allowed to see. */
export function visibleChannelWhere(user: AuthUser): Prisma.ChannelWhereInput {
  if (user.perms.has("admin")) {
    return { OR: [{ type: "TEXT" }, { members: { some: { userId: user.id } } }] };
  }
  return {
    OR: [
      { type: "TEXT", isPrivate: false },
      { type: "TEXT", isPrivate: true, allowedRoles: { some: { id: { in: user.roleIds } } } },
      { members: { some: { userId: user.id } } },
    ],
  };
}

export async function canAccessChannel(user: AuthUser, channelId: string) {
  return prisma.channel.findFirst({
    where: { id: channelId, AND: [visibleChannelWhere(user)] },
  });
}

/** Document types only visible to people with the "documents.sensitive" permission. */
export const SENSITIVE_DOC_TYPES = ["BUDGET", "CONTRACT"] as const;

export function documentVisibilityWhere(user: AuthUser): Prisma.DocumentWhereInput {
  if (user.perms.has("documents.sensitive")) return {};
  return { OR: [{ type: { notIn: [...SENSITIVE_DOC_TYPES] } }, { createdById: user.id }] };
}
