-- Tasks, to-dos and measurements (kinds), flex / once modes, day rules for fixed
-- schedules, and the daily care reminder time (PLAN.md §15).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "careRemindTime" TEXT NOT NULL DEFAULT '17:00';

-- AlterTable
ALTER TABLE "Medicine" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'medicine';
ALTER TABLE "Medicine" ADD COLUMN "weekdays" TEXT;
ALTER TABLE "Medicine" ADD COLUMN "everyDays" INTEGER;
ALTER TABLE "Medicine" ADD COLUMN "maxDays" INTEGER;
ALTER TABLE "Medicine" ADD COLUMN "minDays" INTEGER;
ALTER TABLE "Medicine" ADD COLUMN "dueOn" TEXT;

-- AlterTable
ALTER TABLE "ScheduleVersion" ADD COLUMN "weekdays" TEXT;
ALTER TABLE "ScheduleVersion" ADD COLUMN "everyDays" INTEGER;
