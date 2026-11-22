import type { Medicine } from "@prisma/client";
import type { MedicineInput } from "@/lib/schemas";
import { sortTimes } from "@/lib/schedule";

/** Fields whose change starts a new schedule version (history keeps the old one). */
export const SCHEDULE_FIELDS = [
  "mode",
  "doseAmount",
  "times",
  "intervalH",
  "weekdays",
  "everyDays",
  "maxDays",
  "minDays",
  "dueOn",
  "startsOn",
  "endsOn",
  "minIntervalMin",
] as const;

/** Validated input → Prisma data (JSON strings, sorted times, mode-specific cleanup). */
export function toMedicineData(input: Partial<MedicineInput>) {
  const { presets, times, weekdays, personId: _personId, lastDoneAt: _lastDoneAt, ...rest } = input;
  void _personId;
  void _lastDoneAt;
  const data: Record<string, unknown> = { ...rest };
  if (presets !== undefined) data.presets = JSON.stringify(presets);
  if (times !== undefined) data.times = times && times.length ? JSON.stringify(sortTimes(times)) : null;
  if (weekdays !== undefined) {
    data.weekdays = weekdays && weekdays.length ? JSON.stringify([...new Set(weekdays)].sort((a, b) => a - b)) : null;
  }
  return data;
}

export function scheduleChanged(before: Medicine, data: Record<string, unknown>) {
  return SCHEDULE_FIELDS.some(
    (k) => k in data && (data[k] ?? null) !== (before[k] ?? null),
  );
}
