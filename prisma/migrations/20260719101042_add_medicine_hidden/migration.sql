-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Medicine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
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
    CONSTRAINT "Medicine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Medicine" ("archivedAt", "color", "createdAt", "defaultPreset", "form", "id", "maxPerDay", "maxPerIntake", "minIntervalMin", "name", "notes", "presets", "scheduleHints", "sortOrder", "unit", "userId") SELECT "archivedAt", "color", "createdAt", "defaultPreset", "form", "id", "maxPerDay", "maxPerIntake", "minIntervalMin", "name", "notes", "presets", "scheduleHints", "sortOrder", "unit", "userId" FROM "Medicine";
DROP TABLE "Medicine";
ALTER TABLE "new_Medicine" RENAME TO "Medicine";
CREATE INDEX "Medicine_userId_archivedAt_idx" ON "Medicine"("userId", "archivedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
