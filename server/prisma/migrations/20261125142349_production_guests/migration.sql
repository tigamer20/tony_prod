-- CreateTable
CREATE TABLE "ProductionGuest" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionGuest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionGuest_productionId_idx" ON "ProductionGuest"("productionId");

-- AddForeignKey
ALTER TABLE "ProductionGuest" ADD CONSTRAINT "ProductionGuest_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE CASCADE ON UPDATE CASCADE;
