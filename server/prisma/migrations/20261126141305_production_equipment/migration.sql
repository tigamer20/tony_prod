-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('NEEDED', 'SECURED', 'PACKED', 'RETURNED');

-- CreateTable
CREATE TABLE "ProductionEquipment" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'NEEDED',
    "source" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionEquipment_productionId_idx" ON "ProductionEquipment"("productionId");

-- AddForeignKey
ALTER TABLE "ProductionEquipment" ADD CONSTRAINT "ProductionEquipment_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE CASCADE ON UPDATE CASCADE;
