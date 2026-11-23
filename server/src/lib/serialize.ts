import type { Prisma } from "@prisma/client";

export const AVATAR_COLORS = ["#5865f2", "#eb459e", "#3ba55d", "#f0b232", "#ed4245", "#1abc9c", "#9b59b6", "#e67e22"];

/** Fields of a user that are safe to show to other team members. */
export const publicUserSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
  avatarUpdatedAt: true,
  jobTitle: true,
  roles: { select: { id: true, name: true, color: true, position: true }, orderBy: { position: "desc" } },
} satisfies Prisma.UserSelect;

export const miniUserSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
  avatarUpdatedAt: true,
} satisfies Prisma.UserSelect;

export const memberDetailSelect = {
  ...publicUserSelect,
  email: true,
  phone: true,
  bio: true,
  status: true,
  isOwner: true,
  mustChangePassword: true,
  createdAt: true,
  lastSeenAt: true,
} satisfies Prisma.UserSelect;
