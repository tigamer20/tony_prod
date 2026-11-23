/*
  Warnings:

  - You are about to drop the column `storageKey` on the `Attachment` table. All the data in the column will be lost.
  - Added the required column `data` to the `Attachment` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Attachment_storageKey_key";

-- AlterTable
ALTER TABLE "Attachment" DROP COLUMN "storageKey",
ADD COLUMN     "data" BYTEA NOT NULL;

-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");
