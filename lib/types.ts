import type { Medicine, DoseLog, User } from "@prisma/client";
import type { SafetyResult } from "@/lib/safety";

export type MedicineDTO = Omit<Medicine, "presets" | "scheduleHints" | "createdAt" | "archivedAt"> & {
  presets: string;
  scheduleHints: string | null;
  createdAt: string;
  archivedAt: string | null;
};

export type DoseDTO = Omit<DoseLog, "takenAt" | "createdAt" | "updatedAt"> & {
  takenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ProfileDTO = Omit<User, "createdAt"> & { createdAt: string };

export function parsePresets(m: MedicineDTO): number[] {
  try {
    const p = JSON.parse(m.presets);
    return Array.isArray(p) && p.length ? p : [1];
  } catch {
    return [1];
  }
}

export const MEDICINE_COLORS = [
  "blue",
  "teal",
  "violet",
  "rose",
  "amber",
  "lime",
] as const;
export type MedicineColor = (typeof MEDICINE_COLORS)[number];

export const colorClasses: Record<
  string,
  { accent: string; bg: string; text: string; dot: string }
> = {
  blue: { accent: "border-l-blue-500", bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  teal: { accent: "border-l-teal-500", bg: "bg-teal-500/10", text: "text-teal-600 dark:text-teal-400", dot: "bg-teal-500" },
  violet: { accent: "border-l-violet-500", bg: "bg-violet-500/10", text: "text-violet-600 dark:text-violet-400", dot: "bg-violet-500" },
  rose: { accent: "border-l-rose-500", bg: "bg-rose-500/10", text: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500" },
  amber: { accent: "border-l-amber-500", bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  lime: { accent: "border-l-lime-500", bg: "bg-lime-500/10", text: "text-lime-600 dark:text-lime-400", dot: "bg-lime-500" },
};

export type LogResponse = { dose: DoseDTO; safety: SafetyResult };
