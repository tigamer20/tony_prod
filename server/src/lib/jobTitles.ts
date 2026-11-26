import { prisma } from "../db.js";

/** Lower-case, accent-free, single-spaced: "Caméraman" and "cameraman" fold to the same thing. */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * A job title that matches a role (ignoring accents and capitals) is stored exactly as the role is spelled,
 * so "cameraman" becomes "Caméraman". Anything else is kept as typed.
 */
export async function canonicalJobTitle(title: string | null | undefined): Promise<string | null> {
  const typed = title?.trim();
  if (!typed) return null;
  const roles = await prisma.role.findMany({ select: { name: true } });
  const key = fold(typed);
  return roles.find((r) => fold(r.name) === key)?.name ?? typed;
}

/** Fixes titles saved before this existed (including the copies kept on productions). Safe to run on every start. */
export async function normalizeStoredJobTitles() {
  const roles = await prisma.role.findMany({ select: { name: true } });
  const byKey = new Map(roles.map((r) => [fold(r.name), r.name]));
  const fix = (title: string | null) => (title ? byKey.get(fold(title)) : undefined);

  for (const u of await prisma.user.findMany({ where: { jobTitle: { not: null } }, select: { id: true, jobTitle: true } })) {
    const name = fix(u.jobTitle);
    if (name && name !== u.jobTitle) await prisma.user.update({ where: { id: u.id }, data: { jobTitle: name } });
  }
  for (const m of await prisma.productionMember.findMany({ where: { jobTitle: { not: null } }, select: { productionId: true, userId: true, jobTitle: true } })) {
    const name = fix(m.jobTitle);
    if (name && name !== m.jobTitle) {
      await prisma.productionMember.update({ where: { productionId_userId: { productionId: m.productionId, userId: m.userId } }, data: { jobTitle: name } });
    }
  }
}
