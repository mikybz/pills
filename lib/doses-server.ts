import type { Medicine, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assignSlot, DAY, isScheduled, slotForLog } from "@/lib/schedule";
import { checkDose } from "@/lib/safety";
import { scheduleOf, toLogEntries, type PersonDay } from "@/lib/types";

type MedicineWithTz = Medicine & { person: PersonDay };

/** Logs of a medicine around `at` (by taken time or slot), enough for slots and checks. */
export async function logsAround(medicine: MedicineWithTz, at: number, excludeId?: string) {
  const lo = new Date(at - 3 * DAY);
  const hi = new Date(at + 3 * DAY);
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

export function checkFor(
  medicine: MedicineWithTz,
  user: User,
  logs: ReturnType<typeof toLogEntries>,
  req: { amount: number; at: number; status: "taken" | "uncertain" | "skipped"; slotAt: number | null },
) {
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
  });
}
