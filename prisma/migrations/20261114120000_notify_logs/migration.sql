-- Push when someone else logs a dose for a shared person (opt-in).
ALTER TABLE "PersonAccess" ADD COLUMN "notifyLogs" BOOLEAN NOT NULL DEFAULT false;
