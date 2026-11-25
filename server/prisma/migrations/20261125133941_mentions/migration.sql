-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "mentionsEveryone" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Mention" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "messageId" TEXT,
    "channelId" TEXT,
    "documentId" TEXT,
    "everyone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mention_userId_readAt_createdAt_idx" ON "Mention"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Mention_channelId_idx" ON "Mention"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Mention_userId_messageId_key" ON "Mention"("userId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Mention_userId_documentId_key" ON "Mention"("userId", "documentId");

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing databases already have their default roles, which are never overwritten, so grant the new
-- "mention everyone" permission to the two roles that get it by default (administrators have everything).
UPDATE "Role"
SET "permissions" = array_append("permissions", 'mentions.everyone')
WHERE "name" IN ('Producer', 'Department Head')
  AND NOT ('mentions.everyone' = ANY("permissions"));
