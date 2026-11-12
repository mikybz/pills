import { z } from "zod";
import { isValidTimeZone } from "@/lib/tz";

const timeZone = z.string().min(1).max(64).refine(isValidTimeZone, "invalid time zone");
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const personUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  kind: z.enum(["person", "dog", "cat", "other"]).optional(),
  timezone: timeZone.optional(),
});

export const personSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["person", "dog", "cat", "other"]).default("person"),
  timezone: timeZone.optional(),
});

export const joinSchema = z.object({ code: z.string().min(4).max(40) });

export const accessSchema = z.object({ reminders: z.boolean() });

export const migrateSchema = z.object({ timezone: timeZone.optional() });

export const reviewSchema = z.object({ medicineIds: z.array(z.string().min(1)).min(1).optional() });

export const MODES = ["fixed", "interval", "asNeeded"] as const;

export const medicineSchema = z.object({
  personId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(100),
  form: z
    .enum(["pill", "tablet", "capsule", "spray", "drops", "injection", "liquid", "other"])
    .default("pill"),
  unit: z.string().min(1).max(10).default("pcs"),
  color: z.string().max(20).default("blue"),
  presets: z.array(z.number().positive()).min(1).max(4),
  defaultPreset: z.number().positive().nullable().optional(),
  maxPerIntake: z.number().positive().nullable().optional(),
  maxPerDay: z.number().positive().nullable().optional(),
  minIntervalMin: z.number().int().positive().nullable().optional(),
  mode: z.enum(MODES),
  doseAmount: z.number().positive().nullable().optional(),
  times: z.array(clock).max(24).nullable().optional(),
  intervalH: z.number().min(1).max(72).nullable().optional(),
  startsOn: localDate.nullable().optional(),
  endsOn: localDate.nullable().optional(),
  remindersEnabled: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
  hidden: z.boolean().optional(),
});

export type MedicineInput = z.infer<typeof medicineSchema>;

/** Cross-field rules, checked on the merged result of create/update. */
export function scheduleProblem(m: {
  mode: string | null;
  doseAmount?: number | null;
  times?: string[] | null;
  intervalH?: number | null;
  startsOn?: string | null;
  endsOn?: string | null;
}): string | null {
  if ((m.mode === "fixed" || m.mode === "interval") && !m.doseAmount) return "doseAmount required";
  if (m.mode === "fixed" && !m.times?.length) return "times required";
  if (m.mode === "interval" && !m.intervalH) return "intervalH required";
  if (m.startsOn && m.endsOn && m.endsOn < m.startsOn) return "endsOn before startsOn";
  return null;
}

export const doseSchema = z.object({
  medicineId: z.string().min(1),
  amount: z.number().positive(),
  takenAt: z.coerce.date().optional(),
  /** The scheduled instant this log answers; assigned by the server when absent. */
  slotAt: z.coerce.date().nullable().optional(),
  status: z.enum(["taken", "uncertain", "skipped"]).default("taken"),
  note: z.string().max(1000).nullable().optional(),
});

export const profileSchema = z.object({
  locale: z.enum(["en", "nb"]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  countUncertain: z.boolean().optional(),
  onboarded: z.boolean().optional(),
  defaultPersonId: z.string().min(1).optional(),
  remindersOn: z.boolean().optional(),
  remindLeadMin: z.number().int().min(0).max(120).optional(),
  nagEveryMin: z.number().int().min(0).max(120).optional(),
  nagMaxMin: z.number().int().min(0).max(720).optional(),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});

export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) });

export const snoozeSchema = z.object({
  items: z
    .array(z.object({ medicineId: z.string().min(1), slotAt: z.coerce.date() }))
    .min(1)
    .max(20),
});
