-- Schedules and reminders (REWRITE.md). Existing medicines keep mode = NULL; the app
-- guesses a schedule per person on first open and the user reviews it.

-- AlterTable
ALTER TABLE "DoseLog" ADD COLUMN "slotAt" DATETIME;

-- CreateTable
CREATE TABLE "ScheduleVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "medicineId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "doseAmount" REAL,
    "times" TEXT,
    "intervalH" REAL,
    "startsOn" TEXT,
    "endsOn" TEXT,
    "minIntervalMin" INTEGER,
    "timezone" TEXT NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduleVersion_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "medicineId" TEXT NOT NULL,
    "slotAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "until" DATETIME,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReminderLog_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReminderLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Medicine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "personId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "form" TEXT NOT NULL DEFAULT 'pill',
    "unit" TEXT NOT NULL DEFAULT 'mg',
    "color" TEXT NOT NULL DEFAULT 'blue',
    "presets" TEXT NOT NULL DEFAULT '[1]',
    "defaultPreset" REAL,
    "maxPerIntake" REAL,
    "maxPerDay" REAL,
    "minIntervalMin" INTEGER,
    "mode" TEXT,
    "doseAmount" REAL,
    "times" TEXT,
    "intervalH" REAL,
    "startsOn" TEXT,
    "endsOn" TEXT,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "scheduleReviewedAt" DATETIME,
    "scheduleChangedAt" DATETIME,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Medicine_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Medicine" ("archivedAt", "color", "createdAt", "defaultPreset", "form", "hidden", "id", "maxPerDay", "maxPerIntake", "minIntervalMin", "name", "notes", "personId", "presets", "sortOrder", "unit") SELECT "archivedAt", "color", "createdAt", "defaultPreset", "form", "hidden", "id", "maxPerDay", "maxPerIntake", "minIntervalMin", "name", "notes", "personId", "presets", "sortOrder", "unit" FROM "Medicine";
DROP TABLE "Medicine";
ALTER TABLE "new_Medicine" RENAME TO "Medicine";
CREATE INDEX "Medicine_personId_archivedAt_idx" ON "Medicine"("personId", "archivedAt");
CREATE TABLE "new_Person" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'person',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Oslo',
    "selfOfUserId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Person_selfOfUserId_fkey" FOREIGN KEY ("selfOfUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Person_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Person" ("createdAt", "createdById", "id", "kind", "name", "selfOfUserId") SELECT "createdAt", "createdById", "id", "kind", "name", "selfOfUserId" FROM "Person";
DROP TABLE "Person";
ALTER TABLE "new_Person" RENAME TO "Person";
CREATE UNIQUE INDEX "Person_selfOfUserId_key" ON "Person"("selfOfUserId");
CREATE TABLE "new_PersonAccess" (
    "personId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reminders" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("personId", "userId"),
    CONSTRAINT "PersonAccess_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PersonAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PersonAccess" ("createdAt", "personId", "userId") SELECT "createdAt", "personId", "userId" FROM "PersonAccess";
DROP TABLE "PersonAccess";
ALTER TABLE "new_PersonAccess" RENAME TO "PersonAccess";
CREATE INDEX "PersonAccess_userId_idx" ON "PersonAccess"("userId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "countUncertain" BOOLEAN NOT NULL DEFAULT true,
    "remindersOn" BOOLEAN NOT NULL DEFAULT true,
    "remindLeadMin" INTEGER NOT NULL DEFAULT 10,
    "nagEveryMin" INTEGER NOT NULL DEFAULT 15,
    "nagMaxMin" INTEGER NOT NULL DEFAULT 120,
    "onboarded" BOOLEAN NOT NULL DEFAULT false,
    "defaultPersonId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_defaultPersonId_fkey" FOREIGN KEY ("defaultPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("countUncertain", "createdAt", "defaultPersonId", "email", "id", "locale", "name", "onboarded", "theme") SELECT "countUncertain", "createdAt", "defaultPersonId", "email", "id", "locale", "name", "onboarded", "theme" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ScheduleVersion_medicineId_validTo_idx" ON "ScheduleVersion"("medicineId", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "ReminderLog_sentAt_idx" ON "ReminderLog"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderLog_medicineId_slotAt_userId_kind_seq_key" ON "ReminderLog"("medicineId", "slotAt", "userId", "kind", "seq");

-- CreateIndex
CREATE INDEX "DoseLog_medicineId_slotAt_idx" ON "DoseLog"("medicineId", "slotAt");


-- Backfill: reminders default on for each user's own (self) person, off for shared ones.
UPDATE "PersonAccess" SET "reminders" = 1
WHERE EXISTS (
    SELECT 1 FROM "Person" p
    WHERE p."id" = "PersonAccess"."personId" AND p."selfOfUserId" = "PersonAccess"."userId"
);
