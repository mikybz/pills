import type { Medicine, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assignSlot, DAY, isCare, isScheduled, slotForLog, spanDays } from "@/lib/schedule";
import { checkDose } from "@/lib/safety";
import { kindOf, scheduleOf, toLogEntries, type PersonDay } from "@/lib/types";

type MedicineWithTz = Medicine & { person: PersonDay };

/** Logs of a medicine around `at` (by taken time or slot), enough for slots and checks. */
export async function logsAround(medicine: MedicineWithTz, at: number, excludeId?: string) {
  // Weekly / every-N-days schedules need the neighbouring scheduled days too.
  const pad = (spanDays(scheduleOf(medicine, medicine.person)) + 2) * DAY;
  const lo = new Date(at - pad);
  const hi = new Date(at + pad);
  const rows = await prisma.doseLog.findMany({
    where: {
      medicineId: medicine.id,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ takenAt: { gte: lo, lte: hi } }, { slotAt: { gte: lo, lte: hi } }],
    },
  });
  return toLogEntries(rows, medicine);
}

export function anchorOf(m: Medicine) {
  return (m.scheduleReviewedAt ?? m.createdAt).getTime();
}

/**
 * The slot a new or edited log answers (the server is the source of truth).
 * An explicit slot goes through `slotForLog`, so a stale client or the service
 * worker can't fill today's slot with a dose backdated to yesterday; with no
 * slot sent the server assigns one with the same pure rule the client uses.
 * Explicit null = no slot. Null for as-needed medicines.
 */
export function resolveSlot(args: {
  medicine: MedicineWithTz;
  user: User;
  logs: ReturnType<typeof toLogEntries>;
  at: number;
  requested: Date | null | undefined;
  rule?: "auto" | "window";
}): number | null {
  const { medicine, user, logs, at, requested } = args;
  const schedule = scheduleOf(medicine, medicine.person);
  if (!isScheduled(schedule.mode)) return null;
  if (requested === null) return null;
  const opts = { leadMin: user.remindLeadMin, anchor: anchorOf(medicine), rule: args.rule };
  if (requested) return slotForLog(schedule, logs, requested.getTime(), at, Date.now(), opts);
  return assignSlot(schedule, logs, at, Date.now(), opts);
}

/** Care schedules: the last taken / uncertain log at or before `at` (may be older than `logsAround`). */
export async function lastTakenBefore(medicine: MedicineWithTz, at: number): Promise<number | null> {
  if (!isCare(medicine.mode)) return null;
  const row = await prisma.doseLog.findFirst({
    where: { medicineId: medicine.id, status: { in: ["taken", "uncertain"] }, takenAt: { lte: new Date(at) } },
    orderBy: { takenAt: "desc" },
    select: { takenAt: true },
  });
  return row?.takenAt.getTime() ?? null;
}

export function checkFor(
  medicine: MedicineWithTz,
  user: User,
  logs: ReturnType<typeof toLogEntries>,
  req: { amount: number; at: number; status: "taken" | "uncertain" | "skipped"; slotAt: number | null },
  lastTakenAt: number | null = null,
) {
  // A measurement is a reading, not a dose: nothing to warn about.
  if (kindOf(medicine) === "measure") return { level: "ok" as const, reasons: [] };
  return checkDose({
    schedule: scheduleOf(medicine, medicine.person),
    limits: {
      maxPerIntake: medicine.maxPerIntake,
      maxPerDay: medicine.maxPerDay,
      minIntervalMin: medicine.minIntervalMin,
    },
    logs,
    req,
    countUncertain: user.countUncertain,
    lastTakenAt,
  });
}
