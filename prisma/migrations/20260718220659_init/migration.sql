-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "strictness" REAL NOT NULL DEFAULT 0.15,
    "wakeWindowH" REAL NOT NULL DEFAULT 12,
    "countUncertain" BOOLEAN NOT NULL DEFAULT true,
    "onboarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Medicine" (
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
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Medicine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DoseLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "takenAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'taken',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DoseLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DoseLog_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Medicine_userId_archivedAt_idx" ON "Medicine"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "DoseLog_userId_takenAt_idx" ON "DoseLog"("userId", "takenAt");

-- CreateIndex
CREATE INDEX "DoseLog_medicineId_takenAt_idx" ON "DoseLog"("medicineId", "takenAt");
