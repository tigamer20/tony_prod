import type { Prisma } from "@prisma/client";
import type { AuthUser } from "./auth.js";
import { prisma } from "./db.js";
import { permissionsFor } from "./permissions.js";

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

// ─── Who can be mentioned ────────────────────────────────────────────────

export interface MentionableUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
}

const audienceSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
  isOwner: true,
  roles: { select: { id: true, permissions: true } },
} satisfies Prisma.UserSelect;

const mentionable = ({ id, username, displayName, avatarColor }: MentionableUser): MentionableUser => ({ id, username, displayName, avatarColor });

/** Every active member who is allowed to see a channel. Mirrors visibleChannelWhere(), person by person. */
export async function channelAudience(channelId: string): Promise<MentionableUser[]> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { allowedRoles: { select: { id: true } }, members: { select: { userId: true } } },
  });
  if (!channel) return [];
  const memberIds = new Set(channel.members.map((m) => m.userId));
  const roleIds = new Set(channel.allowedRoles.map((r) => r.id));
  const users = await prisma.user.findMany({ where: { status: "ACTIVE", isSystem: false }, select: audienceSelect });
  return users
    .filter((u) => {
      if (channel.type === "DM") return memberIds.has(u.id);
      if (!channel.isPrivate) return true;
      return permissionsFor(u).has("admin") || u.roles.some((r) => roleIds.has(r.id)) || memberIds.has(u.id);
    })
    .map(mentionable);
}

/** Every active member who is allowed to open a document (budgets and contracts are restricted). */
export async function documentAudience(doc: { type: string; createdById: string }): Promise<MentionableUser[]> {
  const users = await prisma.user.findMany({ where: { status: "ACTIVE", isSystem: false }, select: audienceSelect });
  const restricted = (SENSITIVE_DOC_TYPES as readonly string[]).includes(doc.type);
  return users
    .filter((u) => !restricted || u.id === doc.createdById || permissionsFor(u).has("documents.sensitive"))
    .map(mentionable);
}
