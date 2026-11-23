// Local demo data: a few team members with different roles, one production, tasks, events, an announcement.
// Run with `npm run db:seed`. Refuses to run in production.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { ensureDefaults } from "../src/bootstrap.js";
import { TEMPLATES } from "../src/lib/templates.js";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production.");

const prisma = new PrismaClient();
await ensureDefaults();

const DEMO_PASSWORD = "demo-password-1";
const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

const people = [
  { username: "maya", displayName: "Maya Chen", role: "Producer", jobTitle: "Line Producer", color: "#f0b232" },
  { username: "leo", displayName: "Leo Martin", role: "Department Head", jobTitle: "Director of Photography", color: "#3ba55d" },
  { username: "sam", displayName: "Sam Okafor", role: "Crew", jobTitle: "Gaffer", color: "#5865f2" },
  { username: "nina", displayName: "Nina Rossi", role: "Client / Guest", jobTitle: "Guest", color: "#99aab5" },
];

const users: Record<string, string> = {};
for (const p of people) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: p.role } });
  const user = await prisma.user.upsert({
    where: { username: p.username },
    update: {},
    create: {
      username: p.username,
      email: `${p.username}@example.test`,
      displayName: p.displayName,
      jobTitle: p.jobTitle,
      avatarColor: p.color,
      passwordHash: hash,
      roles: { connect: [{ id: role.id }] },
    },
  });
  users[p.username] = user.id;
}

if ((await prisma.production.count()) === 0) {
  const creator = users.maya!;
  const day = 86_400_000;
  const at = (offsetDays: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(hour, 0, 0, 0);
    return d;
  };

  const production = await prisma.production.create({
    data: {
      title: "Winter Camping Challenge",
      status: "PRE_PRODUCTION",
      description: "A 15-minute video: 48 hours camping in the Laurentians in the snow, plus a short teaser for Shorts.",
      location: "Mont-Tremblant, QC",
      budget: 1200,
      color: "#eb459e",
      shootDate: at(3, 8),
      shootEndDate: at(5, 18),
      releaseDate: new Date(+at(0, 9) + 28 * day),
      createdById: creator,
      members: { create: Object.values(users).map((userId) => ({ userId })) },
      channels: { create: { name: "winter-camping-challenge", category: "Productions", topic: "Chat for Winter Camping Challenge" } },
    },
  });

  await prisma.task.createMany({
    data: [
      { title: "Lock shot list with director", status: "IN_PROGRESS", priority: "HIGH", dueDate: at(1, 17), assigneeId: users.leo!, productionId: production.id, createdById: creator },
      { title: "Book camera & lighting package", status: "TODO", priority: "URGENT", dueDate: at(2, 12), assigneeId: users.maya!, productionId: production.id, createdById: creator },
      { title: "Scout location B", status: "REVIEW", priority: "MEDIUM", assigneeId: users.sam!, productionId: production.id, createdById: creator },
      { title: "Write the video outline", status: "DONE", priority: "MEDIUM", productionId: production.id, createdById: creator },
    ],
  });

  await prisma.event.createMany({
    data: [
      { title: "Pre-production meeting", type: "MEETING", start: at(1, 10), end: at(1, 11), location: "Studio A", productionId: production.id, createdById: creator },
      { title: "Shoot day 1", type: "SHOOT", start: at(3, 7), end: at(3, 19), location: "Mont-Tremblant, QC", productionId: production.id, createdById: creator },
      { title: "Shoot day 2", type: "SHOOT", start: at(4, 7), end: at(4, 19), location: "Mont-Tremblant, QC", productionId: production.id, createdById: creator },
      { title: "Rough cut review", type: "REVIEW", start: at(12, 14), end: at(12, 15), productionId: production.id, createdById: creator },
      { title: "Video release", type: "DELIVERY", start: at(28, 9), end: at(28, 10), allDay: true, productionId: production.id, createdById: creator },
    ],
  });

  await prisma.announcement.create({
    data: {
      title: "Winter camping shoot plan",
      body: "Call times will be posted 48 hours before each shoot day. Please confirm your availability on the calendar and read the outline before the pre-production meeting.",
      priority: "IMPORTANT",
      pinned: true,
      productionId: production.id,
      authorId: creator,
    },
  });

  const callSheet = TEMPLATES.find((t) => t.key === "call-sheet")!;
  await prisma.document.create({
    data: {
      title: "Call Sheet - Shoot Day 1",
      type: "CALL_SHEET",
      content: callSheet.build() as object,
      productionId: production.id,
      createdById: creator,
      updatedById: creator,
    },
  });
}

console.log(`Demo data ready. Demo members: ${people.map((p) => p.username).join(", ")} (password: ${DEMO_PASSWORD})`);
await prisma.$disconnect();
