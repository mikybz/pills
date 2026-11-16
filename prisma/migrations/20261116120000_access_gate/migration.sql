-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "role" TEXT NOT NULL DEFAULT 'member',
    "idpAdmin" BOOLEAN NOT NULL DEFAULT false,
    "blockedAt" DATETIME,
    "lastSeenAt" DATETIME,
    CONSTRAINT "User_defaultPersonId_fkey" FOREIGN KEY ("defaultPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("countUncertain", "createdAt", "defaultPersonId", "email", "id", "locale", "nagEveryMin", "nagMaxMin", "name", "onboarded", "remindLeadMin", "remindersOn", "theme") SELECT "countUncertain", "createdAt", "defaultPersonId", "email", "id", "locale", "nagEveryMin", "nagMaxMin", "name", "onboarded", "remindLeadMin", "remindersOn", "theme" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- pills is open to the public from the start (admins can close sign-ups in the app).
INSERT INTO "AppSetting" ("key", "value") VALUES ('signupsOpen', 'true');
