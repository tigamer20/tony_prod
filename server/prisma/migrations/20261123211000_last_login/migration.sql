-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- Existing members who have clearly signed in before should not show up as "Pending".
-- Accounts an admin created start with mustChangePassword = true and only clear it by signing in,
-- so everyone else (or anyone we have seen online) counts as having signed in.
UPDATE "User"
SET "lastLoginAt" = COALESCE("lastSeenAt", "createdAt")
WHERE "lastSeenAt" IS NOT NULL OR "mustChangePassword" = false;
