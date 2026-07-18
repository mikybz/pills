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

// Fixed categorical order; hexes validated for CVD separation and 3:1 surface
// contrast in light and dark mode (Tailwind 600-level).
export const MEDICINE_COLORS = [
  "blue",
  "amber",
  "teal",
  "rose",
  "violet",
  "lime",
] as const;
export type MedicineColor = (typeof MEDICINE_COLORS)[number];

export const colorClasses: Record<
  string,
  { accent: string; bg: string; text: string; dot: string; chart: string }
> = {
  blue: { accent: "border-l-blue-600", bg: "bg-blue-600/10", text: "text-blue-600 dark:text-blue-400", dot: "bg-blue-600", chart: "#2563eb" },
  amber: { accent: "border-l-amber-600", bg: "bg-amber-600/10", text: "text-amber-600 dark:text-amber-400", dot: "bg-amber-600", chart: "#d97706" },
  teal: { accent: "border-l-teal-600", bg: "bg-teal-600/10", text: "text-teal-600 dark:text-teal-400", dot: "bg-teal-600", chart: "#0d9488" },
  rose: { accent: "border-l-rose-600", bg: "bg-rose-600/10", text: "text-rose-600 dark:text-rose-400", dot: "bg-rose-600", chart: "#e11d48" },
  violet: { accent: "border-l-violet-600", bg: "bg-violet-600/10", text: "text-violet-600 dark:text-violet-400", dot: "bg-violet-600", chart: "#7c3aed" },
  lime: { accent: "border-l-lime-600", bg: "bg-lime-600/10", text: "text-lime-600 dark:text-lime-400", dot: "bg-lime-600", chart: "#65a30d" },
};

export type LogResponse = { dose: DoseDTO; safety: SafetyResult };
