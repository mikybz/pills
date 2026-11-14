import type { Medicine, DoseLog, User } from "@prisma/client";
import type { CheckResult } from "@/lib/safety";
import { DEFAULT_DAY, fitTimes, isFinished, sortTimes, type DayWindow, type LogEntry, type Mode, type Schedule, type Segment, type DoseStatus } from "./schedule";

/** A schedule that was in force before an edit (history only). */
export interface ScheduleVersionDTO {
  mode: string;
  doseAmount: number | null;
  times: string | null;
  intervalH: number | null;
  startsOn: string | null;
  endsOn: string | null;
  minIntervalMin: number | null;
  timezone: string;
  validFrom: string;
  validTo: string;
}

export type MedicineDTO = Omit<
  Medicine,
  "createdAt" | "archivedAt" | "scheduleReviewedAt" | "scheduleChangedAt"
> & {
  createdAt: string;
  archivedAt: string | null;
  scheduleReviewedAt: string | null;
  scheduleChangedAt: string | null;
  /** Included with `?versions=true`. */
  scheduleVersions?: ScheduleVersionDTO[];
};

export type DoseDTO = Omit<DoseLog, "takenAt" | "slotAt" | "createdAt" | "updatedAt"> & {
  takenAt: string;
  slotAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Who logged the dose (included on list endpoints). */
  loggedBy?: { id: string; name: string | null; email: string } | null;
};

export const PERSON_KINDS = ["person", "dog", "cat", "other"] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

export interface PersonMember {
  id: string;
  name: string;
  email: string;
  isMe: boolean;
  isOwner: boolean;
}

export interface PersonDTO {
  id: string;
  name: string;
  kind: string;
  /** IANA zone the fixed times are wall-clock times in. */
  timezone: string;
  /** Usual awake hours ("HH:MM", wall clock in `timezone`); may wrap midnight. */
  wakeTime: string;
  bedTime: string;
  /** Whether the signed-in user gets reminders for this person. */
  reminders: boolean;
  /** Whether the signed-in user gets a push when someone else logs a dose for this person. */
  notifyLogs: boolean;
  /** The signed-in user's own person — can't be deleted. */
  isSelf: boolean;
  /** Another user's own person, shared with me. */
  isOtherUsersSelf: boolean;
  /** Only the creator of a (non-self) person may delete it. */
  canDelete: boolean;
  /** Owner (creator / self user) may remove other members. */
  canManageAccess: boolean;
  ownerId: string;
  members: PersonMember[];
}

export type ProfileDTO = Omit<User, "createdAt"> & { createdAt: string };

export type LogResponse = { dose: DoseDTO; check: CheckResult };

export function parsePresets(m: Pick<MedicineDTO, "presets">): number[] {
  try {
    const p = JSON.parse(m.presets);
    return Array.isArray(p) && p.length ? p : [1];
  } catch {
    return [1];
  }
}

export function parseTimes(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const t = JSON.parse(json);
    return Array.isArray(t) ? t.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

type ScheduleFields = Pick<
  MedicineDTO,
  "mode" | "times" | "intervalH" | "startsOn" | "endsOn" | "minIntervalMin"
>;

/** What schedule math needs from a person: the time zone and the day window. */
export interface PersonDay {
  timezone: string;
  wakeTime: string;
  bedTime: string;
}

export const DEFAULT_PERSON_DAY: PersonDay = {
  timezone: "Europe/Oslo",
  wakeTime: DEFAULT_DAY.wake,
  bedTime: DEFAULT_DAY.bed,
};

/** The person's day window (or the default one). */
export function dayOf(p: Pick<PersonDay, "wakeTime" | "bedTime"> | null | undefined): DayWindow {
  return { wake: p?.wakeTime ?? DEFAULT_DAY.wake, bed: p?.bedTime ?? DEFAULT_DAY.bed };
}

/** Person (or nothing yet) → PersonDay with defaults. */
export function personDayOf(p: Partial<PersonDay> | null | undefined): PersonDay {
  return {
    timezone: p?.timezone ?? DEFAULT_PERSON_DAY.timezone,
    wakeTime: p?.wakeTime ?? DEFAULT_PERSON_DAY.wakeTime,
    bedTime: p?.bedTime ?? DEFAULT_PERSON_DAY.bedTime,
  };
}

function baseSchedule(m: ScheduleFields, timezone: string): Omit<Schedule, "day" | "drift"> {
  const mode = (m.mode ?? "asNeeded") as Mode;
  return {
    mode: mode === "fixed" || mode === "interval" ? mode : "asNeeded",
    times: parseTimes(m.times),
    intervalH: m.intervalH ?? null,
    startsOn: m.startsOn ?? null,
    endsOn: m.endsOn ?? null,
    minIntervalMin: m.minIntervalMin ?? null,
    timezone,
  };
}

/** Medicine → pure Schedule for its person. Unmigrated (null mode) behaves as needed. */
export function scheduleOf(
  m: ScheduleFields & Partial<Pick<MedicineDTO, "aroundTheClock" | "driftEnabled">>,
  person: PersonDay,
): Schedule {
  return {
    ...baseSchedule(m, person.timezone),
    day: m.aroundTheClock ? null : dayOf(person),
    drift: m.driftEnabled ?? true,
  };
}

/** A stored ScheduleVersion → Schedule: no day window and no drift (as it behaved then). */
export function versionScheduleOf(v: ScheduleVersionDTO): Schedule {
  return { ...baseSchedule(v, v.timezone), day: null, drift: false };
}

export interface NightCandidate {
  medicine: MedicineDTO;
  /** Current times (sorted) and the proposal inside the day window (`fitTimes`). */
  from: string[];
  to: string[];
}

/**
 * Medicines whose fixed times reach into the person's sleep window, offered in
 * the night-dose preview: active (not archived / hidden / finished), reviewed,
 * fixed mode, not taken around the clock.
 */
export function nightCandidates(medicines: MedicineDTO[], person: PersonDay, now: number): NightCandidate[] {
  return medicines.flatMap((m) => {
    if (m.archivedAt || m.hidden || !m.scheduleReviewedAt || m.mode !== "fixed" || m.aroundTheClock) return [];
    if (isFinished(scheduleOf(m, person), now)) return [];
    const from = sortTimes(parseTimes(m.times));
    const to = fitTimes(from, dayOf(person));
    return to ? [{ medicine: m, from, to }] : [];
  });
}

/** Amount for one scheduled dose (or the default quick dose). */
export function doseAmountOf(m: Pick<MedicineDTO, "doseAmount" | "defaultPreset" | "presets">) {
  return m.doseAmount ?? m.defaultPreset ?? parsePresets(m)[0];
}

const ms = (d: string | Date | null | undefined) =>
  d == null ? null : typeof d === "string" ? Date.parse(d) : d.getTime();

/** Instant from which this medicine's current schedule applies (reminders, missed slots). */
export function currentScheduleFrom(m: {
  scheduleReviewedAt: string | Date | null;
  scheduleChangedAt: string | Date | null;
}): number | null {
  const reviewed = ms(m.scheduleReviewedAt);
  if (reviewed === null) return null;
  return Math.max(reviewed, ms(m.scheduleChangedAt) ?? reviewed);
}

/** Dose rows → pure log entries. A null-slot log made before review is a legacy log. */
export function toLogEntries(
  doses: { id: string; takenAt: string | Date; slotAt: string | Date | null; status: string; amount: number; createdAt: string | Date }[],
  m: { scheduleReviewedAt: string | Date | null },
): LogEntry[] {
  const reviewed = ms(m.scheduleReviewedAt);
  return doses.map((d) => ({
    id: d.id,
    takenAt: ms(d.takenAt)!,
    slotAt: ms(d.slotAt),
    status: d.status as DoseStatus,
    amount: d.amount,
    legacy: d.slotAt == null && (reviewed === null || ms(d.createdAt)! < reviewed),
  }));
}

/** Schedule segments for history: stored versions plus the current schedule. */
export function segmentsOf(
  m: MedicineDTO,
  person: PersonDay,
  until: number,
): Segment[] {
  const segs: Segment[] = (m.scheduleVersions ?? []).map((v) => ({
    schedule: versionScheduleOf(v),
    from: Date.parse(v.validFrom),
    to: Date.parse(v.validTo),
  }));
  const from = currentScheduleFrom(m);
  if (from !== null) {
    const end = m.archivedAt ? Math.min(until, Date.parse(m.archivedAt)) : until;
    segs.push({ schedule: scheduleOf(m, person), from, to: end });
  }
  return segs.filter((s) => s.to > s.from);
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
