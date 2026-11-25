-- Participants are the people in the video, not the crew: turn the guest list into that, and let an entry point at an account.
ALTER TABLE "ProductionGuest" RENAME TO "ProductionParticipant";
ALTER TABLE "ProductionParticipant" RENAME COLUMN "jobTitle" TO "role";
ALTER TABLE "ProductionParticipant" RENAME CONSTRAINT "ProductionGuest_pkey" TO "ProductionParticipant_pkey";
ALTER TABLE "ProductionParticipant" RENAME CONSTRAINT "ProductionGuest_productionId_fkey" TO "ProductionParticipant_productionId_fkey";
ALTER INDEX "ProductionGuest_productionId_idx" RENAME TO "ProductionParticipant_productionId_idx";
ALTER TABLE "ProductionParticipant" ADD COLUMN "userId" TEXT;
ALTER TABLE "ProductionParticipant" ADD CONSTRAINT "ProductionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
