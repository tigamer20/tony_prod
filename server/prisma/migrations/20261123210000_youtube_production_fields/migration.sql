-- Productions are for a personal YouTube channel: no client and no project type,
-- and the three dates become shoot date, shoot end date and target release date.

-- Keep the existing dates by renaming the columns rather than dropping and re-adding them.
ALTER TABLE "Production" RENAME COLUMN "startDate" TO "shootDate";
ALTER TABLE "Production" RENAME COLUMN "endDate" TO "shootEndDate";
ALTER TABLE "Production" RENAME COLUMN "deliveryDate" TO "releaseDate";

ALTER TABLE "Production" DROP COLUMN "client",
DROP COLUMN "kind";
