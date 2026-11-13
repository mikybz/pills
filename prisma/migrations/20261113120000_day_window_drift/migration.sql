-- Day window per person, and per-medicine "also at night" + late-dose drift (DAYPLAN.md).

-- AlterTable
ALTER TABLE "Person" ADD COLUMN "wakeTime" TEXT NOT NULL DEFAULT '07:00';
ALTER TABLE "Person" ADD COLUMN "bedTime" TEXT NOT NULL DEFAULT '23:00';

-- AlterTable
ALTER TABLE "Medicine" ADD COLUMN "aroundTheClock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Medicine" ADD COLUMN "driftEnabled" BOOLEAN NOT NULL DEFAULT true;
