-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'person',
    "selfOfUserId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Person_selfOfUserId_fkey" FOREIGN KEY ("selfOfUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Person_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PersonAccess" (
    "personId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("personId", "userId"),
    CONSTRAINT "PersonAccess_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PersonAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "usedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareToken_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Backfill: every existing user gets a "self" person that owns their medicines.
INSERT INTO "Person" ("id", "name", "kind", "selfOfUserId", "createdById", "createdAt")
SELECT 'self_' || "id", COALESCE("name", "email"), 'person', "id", "id", CURRENT_TIMESTAMP FROM "User";
INSERT INTO "PersonAccess" ("personId", "userId", "createdAt")
SELECT 'self_' || "id", "id", CURRENT_TIMESTAMP FROM "User";

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
    "scheduleHints" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Medicine_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Medicine" ("archivedAt", "color", "createdAt", "defaultPreset", "form", "hidden", "id", "maxPerDay", "maxPerIntake", "minIntervalMin", "name", "notes", "personId", "presets", "scheduleHints", "sortOrder", "unit") SELECT "archivedAt", "color", "createdAt", "defaultPreset", "form", "hidden", "id", "maxPerDay", "maxPerIntake", "minIntervalMin", "name", "notes", 'self_' || "userId", "presets", "scheduleHints", "sortOrder", "unit" FROM "Medicine";
DROP TABLE "Medicine";
ALTER TABLE "new_Medicine" RENAME TO "Medicine";
CREATE INDEX "Medicine_personId_archivedAt_idx" ON "Medicine"("personId", "archivedAt");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "strictness" REAL NOT NULL DEFAULT 0.15,
    "wakeWindowH" REAL NOT NULL DEFAULT 12,
    "countUncertain" BOOLEAN NOT NULL DEFAULT true,
    "onboarded" BOOLEAN NOT NULL DEFAULT false,
    "defaultPersonId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_defaultPersonId_fkey" FOREIGN KEY ("defaultPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("countUncertain", "createdAt", "defaultPersonId", "email", "id", "locale", "name", "onboarded", "strictness", "theme", "wakeWindowH") SELECT "countUncertain", "createdAt", 'self_' || "id", "email", "id", "locale", "name", "onboarded", "strictness", "theme", "wakeWindowH" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Person_selfOfUserId_key" ON "Person"("selfOfUserId");

-- CreateIndex
CREATE INDEX "PersonAccess_userId_idx" ON "PersonAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareToken_tokenHash_key" ON "ShareToken"("tokenHash");

