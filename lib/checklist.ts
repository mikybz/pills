/**
 * Pure: today's checklist for one person (PLAN.md §1.1). Built from the same
 * schedule functions the server and the reminder tick use.
 */
import {
  DAY,
  fixedSlots,
  intervalSlot,
  isFinished,
  isScheduled,
  spanDays,
  type LogEntry,
  type Schedule,
  type Slot,
} from "./schedule";
import { careStatus, isCareDue, type CareStatus } from "./care";
import { addDays, localDate, startOfLocalDay } from "./tz";

export interface ChecklistMedicine {
  id: string;
  schedule: Schedule;
  logs: LogEntry[];
  /** Interval mode: due time of the very first dose. */
  anchor: number;
  /** Show slots from this instant (after a schedule edit); null = all. */
  slotsFrom: number | null;
  /** Derive missed slots from this instant; null = never (not reviewed). */
  missedFrom: number | null;
}

export interface ChecklistRow {
  medicineId: string;
  slot: Slot;
}

export interface Checklist {
  /** Due and overdue, oldest first (includes yesterday's until their cutoff). */
  due: ChecklistRow[];
  /** Missed today. */
  missed: ChecklistRow[];
  /** Upcoming until local midnight. */
  later: ChecklistRow[];
  /** Today's logs of scheduled medicines (taken / uncertain / skipped). */
  done: { medicineId: string; log: LogEntry }[];
  /** True when there is at least one scheduled medicine on the list. */
  hasScheduled: boolean;
}

export function buildChecklist(meds: ChecklistMedicine[], now: number, leadMin: number): Checklist {
  const out: Checklist = { due: [], missed: [], later: [], done: [], hasScheduled: false };
  for (const m of meds) {
    const s = m.schedule;
    if (!isScheduled(s.mode) || isFinished(s, now)) continue;
    const today = localDate(now, s.timezone);
    const dayStart = startOfLocalDay(today, s.timezone);
    const dayEnd = startOfLocalDay(addDays(today, 1), s.timezone);
    const opts = { now, leadMin, missedFrom: m.missedFrom };

    let slots: Slot[];
    if (s.mode === "fixed") {
      // Weekly doses stay overdue for days: look back one full gap between scheduled days.
      slots = fixedSlots(s, m.logs, dayStart - spanDays(s) * DAY, dayEnd - 1, opts);
    } else {
      const one = intervalSlot(s, m.logs, m.anchor, opts);
      slots = one ? [one] : [];
    }
    slots = slots.filter((sl) => m.slotsFrom === null || sl.slotAt >= m.slotsFrom);
    out.hasScheduled = true;

    for (const slot of slots) {
      const row = { medicineId: m.id, slot };
      if (slot.state === "due" || slot.state === "overdue") out.due.push(row);
      else if (slot.state === "missed" && slot.slotAt >= dayStart) out.missed.push(row);
      else if (slot.state === "upcoming" && slot.effectiveAt < dayEnd) out.later.push(row);
    }
    for (const log of m.logs) {
      if (log.takenAt >= dayStart && log.takenAt < dayEnd) out.done.push({ medicineId: m.id, log });
    }
  }
  const byEffective = (a: ChecklistRow, b: ChecklistRow) => a.slot.effectiveAt - b.slot.effectiveAt;
  out.due.sort(byEffective);
  out.later.sort(byEffective);
  out.missed.sort((a, b) => a.slot.slotAt - b.slot.slotAt);
  out.done.sort((a, b) => a.log.takenAt - b.log.takenAt);
  return out;
}

/* ------------------------------------------------------------------- care */

export interface CareMedicine {
  id: string;
  schedule: Schedule;
  /** Loaded logs (for today's Done list). */
  logs: LogEntry[];
  /** The last log of any status (`lastLogAt`); null = never done. */
  lastAt: number | null;
  /** When the schedule was set up: a flex task never done is due that day. */
  anchor: number;
}

export interface CareRow {
  medicineId: string;
  status: CareStatus;
}

export interface CareList {
  /** Last stretch, due today or overdue: shown under Due now (most urgent first). */
  due: CareRow[];
  /** Not due yet (and one-offs ahead), soonest first: the Tasks section. */
  upcoming: CareRow[];
  /** Today's logs. */
  done: { medicineId: string; log: LogEntry }[];
}

/** Care schedules (flex / once) for today's list (PLAN.md §15.4). Finished one-offs drop off. */
export function buildCareList(items: CareMedicine[], now: number): CareList {
  const out: CareList = { due: [], upcoming: [], done: [] };
  for (const m of items) {
    if (isFinished(m.schedule, now)) continue;
    const status = careStatus(m.schedule, m.lastAt, m.anchor, now);
    if (!status) continue;
    const today = localDate(now, m.schedule.timezone);
    const dayStart = startOfLocalDay(today, m.schedule.timezone);
    const dayEnd = startOfLocalDay(addDays(today, 1), m.schedule.timezone);
    for (const log of m.logs) {
      if (log.takenAt >= dayStart && log.takenAt < dayEnd) out.done.push({ medicineId: m.id, log });
    }
    if (isCareDue(status.state)) out.due.push({ medicineId: m.id, status });
    else if (status.state !== "done") out.upcoming.push({ medicineId: m.id, status });
  }
  const urgent = (a: CareRow, b: CareRow) =>
    a.status.daysLeft - b.status.daysLeft || (a.status.dueAt ?? 0) - (b.status.dueAt ?? 0);
  out.due.sort(urgent);
  out.upcoming.sort(urgent);
  out.done.sort((a, b) => a.log.takenAt - b.log.takenAt);
  return out;
}
