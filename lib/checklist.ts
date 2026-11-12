/**
 * Pure: today's checklist for one person (REWRITE.md §5.1). Built from the same
 * schedule functions the server and the reminder tick use.
 */
import {
  DAY,
  fixedSlots,
  intervalSlot,
  isFinished,
  type LogEntry,
  type Schedule,
  type Slot,
} from "./schedule";
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
    if (s.mode === "asNeeded" || isFinished(s, now)) continue;
    const today = localDate(now, s.timezone);
    const dayStart = startOfLocalDay(today, s.timezone);
    const dayEnd = startOfLocalDay(addDays(today, 1), s.timezone);
    const opts = { now, leadMin, missedFrom: m.missedFrom };

    let slots: Slot[];
    if (s.mode === "fixed") {
      slots = fixedSlots(s, m.logs, dayStart - DAY, dayEnd - 1, opts);
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
