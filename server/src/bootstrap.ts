import { prisma } from "./db.js";
import { normalizeStoredJobTitles } from "./lib/jobTitles.js";
import { DEFAULT_ROLES } from "./permissions.js";

/** Idempotent first-run setup: default roles and starter channels. Never overwrites edits. */
export async function ensureDefaults() {
  for (const role of DEFAULT_ROLES) {
    const existing = await prisma.role.findUnique({ where: { name: role.name } });
    if (!existing) {
      await prisma.role.create({
        data: {
          name: role.name,
          color: role.color,
          position: role.position,
          isDefault: role.isDefault ?? false,
          isSystem: role.name === "Admin",
          permissions: role.permissions,
        },
      });
    }
  }

  if ((await prisma.channel.count()) === 0) {
    await prisma.channel.createMany({
      data: [
        { name: "general", topic: "Team-wide chat", category: "General", position: 0 },
        { name: "random", topic: "Off-topic, memes and inspiration", category: "General", position: 1 },
        { name: "on-set", topic: "Live updates from set and location", category: "Production", position: 2 },
        { name: "post-production", topic: "Edit, color, sound and delivery", category: "Production", position: 3 },
      ],
    });
  }

  // Job titles that match a role should be spelled like the role (accents included).
  await normalizeStoredJobTitles();
}
