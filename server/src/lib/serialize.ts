import type { Prisma } from "@prisma/client";

/** Fields of a user that are safe to show to other team members. */
export const publicUserSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
  jobTitle: true,
  roles: { select: { id: true, name: true, color: true, position: true }, orderBy: { position: "desc" } },
} satisfies Prisma.UserSelect;

export const miniUserSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
} satisfies Prisma.UserSelect;

export const memberDetailSelect = {
  ...publicUserSelect,
  email: true,
  phone: true,
  bio: true,
  status: true,
  isOwner: true,
  createdAt: true,
  lastSeenAt: true,
} satisfies Prisma.UserSelect;
