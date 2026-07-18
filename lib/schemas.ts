import { z } from "zod";

export const medicineSchema = z.object({
  name: z.string().min(1).max(100),
  form: z
    .enum(["pill", "tablet", "capsule", "spray", "drops", "injection", "liquid", "other"])
    .default("pill"),
  unit: z.string().min(1).max(10).default("mg"),
  color: z.string().max(20).default("blue"),
  presets: z.array(z.number().positive()).min(1).max(4),
  defaultPreset: z.number().positive().nullable().optional(),
  maxPerIntake: z.number().positive().nullable().optional(),
  maxPerDay: z.number().positive().nullable().optional(),
  minIntervalMin: z.number().int().positive().nullable().optional(),
  scheduleHints: z.array(z.string().regex(/^\d{2}:\d{2}$/)).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const doseSchema = z.object({
  medicineId: z.string().min(1),
  amount: z.number().positive(),
  takenAt: z.coerce.date().optional(),
  status: z.enum(["taken", "uncertain", "skipped"]).default("taken"),
  note: z.string().max(1000).nullable().optional(),
});

export const profileSchema = z.object({
  locale: z.enum(["en", "nb"]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  strictness: z.number().min(0).max(0.3).optional(),
  wakeWindowH: z.number().min(6).max(24).optional(),
  countUncertain: z.boolean().optional(),
  onboarded: z.boolean().optional(),
});
