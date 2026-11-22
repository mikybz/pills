/**
 * Pure care schedules (no I/O, no clock): tasks, to-dos and measurements that are
 * due by a date rather than at a slot (PLAN.md §15).
 *
 * - flex: "at the latest every `maxDays` days" (optionally "not more often than
 *   every `minDays` days"), counted in local days from the last log of any status
 *   (a skip means "not needed this time" and restarts the count too).
 * - once: due on `dueOn` (optional time `times[0]`); any log finishes it.
 *
 * Days are local dates in the schedule's time zone. Reminders are one daily nudge
 * at the user's care time from `soonDate` until it is done.
 */
import { HOUR, type LogEntry, type Schedule } from "./schedule";
import { addDays, daysBetween, localDate, startOfLocalDay, zonedToUtc } from "./tz";

export type CareState =
  /** Done recently: doing it again now is sooner than `minDays` (warns). */
  | "early"
  /** Not due for a while. */
  | "ok"
  /** In its last stretch: on Due now and nudged daily. */
  | "soon"
  /** Due today (the deadline day). */
  | "today"
  | "overdue"
  /** A one-off that has been logged. */
  | "done";

export interface CareStatus {
  state: CareState;
  /** The last log (any status), or null. */
  lastAt: number | null;
  /** Local date it is due by: last done + maxDays (flex) or `dueOn` (once). */
  dueDate: string;
  /** From this local date on it shows under Due now and gets a daily nudge. */
  soonDate: string;
  /** Flex with `minDays`: doing it before this local date warns. */
  earliestDate: string | null;
  /** dueDate − today in days; negative = overdue by that many days. */
  daysLeft: number;
  /** Identity of this cycle (start of `dueDate`): the `slotAt` of its reminders. */
  cycleAt: number;
  /** Once mode with a time: the due instant. */
  dueAt: number | null;
}

/** The last stretch before the deadline: ~20 % of the window, 1–7 days. */
export function leadDays(maxDays: number): number {
  return Math.min(7, Math.max(1, Math.round(maxDays * 0.2)));
}

/**
 * Latest log time (any status). `fallback` is the medicine's last log from the
 * server (`lastLogAt`); it only counts when it is older than the loaded logs
 * (`loadedFrom`), so an undone log in the loaded range doesn't linger.
 */
export function lastLogAt(logs: LogEntry[], fallback: number | null = null, loadedFrom = -Infinity): number | null {
  let last: number | null = null;
  for (const l of logs) if (last === null || l.takenAt > last) last = l.takenAt;
  if (last === null && fallback !== null && fallback < loadedFrom) return fallback;
  return last;
}

const maxDate = (a: string, b: string) => (a > b ? a : b);

/**
 * Where a care schedule stands `now`. `anchor` = when it was set up (a flex
 * schedule never done is due on that day). Null for other modes or a once
 * schedule without a date.
 */
export function careStatus(s: Schedule, lastAt: number | null, anchor: number, now: number): CareStatus | null {
  const tz = s.timezone;
  const today = localDate(now, tz);
  if (s.mode === "once") {
    if (!s.dueOn) return null;
    const dueDate = s.dueOn;
    const soonDate = addDays(dueDate, -1);
    const time = s.times[0] ?? null;
    return {
      state: lastAt !== null ? "done" : stateOn(today, null, soonDate, dueDate),
      lastAt,
      dueDate,
      soonDate,
      earliestDate: null,
      daysLeft: daysBetween(today, dueDate),
      cycleAt: startOfLocalDay(dueDate, tz),
      dueAt: time ? zonedToUtc(dueDate, time, tz) : null,
    };
  }
  if (s.mode !== "flex") return null;
  const maxDays = Math.max(1, Math.round(s.maxDays ?? 1));
  const lastDate = lastAt === null ? null : localDate(lastAt, tz);
  let dueDate: string;
  let soonDate: string;
  if (lastDate === null) {
    dueDate = localDate(anchor, tz);
    if (s.startsOn && dueDate < s.startsOn) dueDate = s.startsOn;
    soonDate = dueDate;
  } else {
    dueDate = addDays(lastDate, maxDays);
    // Never "soon" on the day it was done (a daily task done today is due tomorrow).
    soonDate = maxDate(addDays(dueDate, -leadDays(maxDays)), addDays(lastDate, 1));
  }
  const earliestDate = lastDate && s.minDays ? addDays(lastDate, s.minDays) : null;
  // "Not more often than" wins over the lead: no nudge to do it while that would warn.
  if (earliestDate) soonDate = maxDate(soonDate, earliestDate);
  return {
    state: stateOn(today, earliestDate, soonDate, dueDate),
    lastAt,
    dueDate,
    soonDate,
    earliestDate,
    daysLeft: daysBetween(today, dueDate),
    cycleAt: startOfLocalDay(dueDate, tz),
    dueAt: null,
  };
}

function stateOn(today: string, earliest: string | null, soon: string, due: string): CareState {
  if (earliest && today < earliest) return "early";
  if (today < soon) return "ok";
  if (today < due) return "soon";
  return today === due ? "today" : "overdue";
}

/** On Due now (and nudged): its last stretch, due today, or overdue. */
export function isCareDue(state: CareState | undefined): boolean {
  return state === "soon" || state === "today" || state === "overdue";
}

export interface CareEvent {
  /** The cycle (`CareStatus.cycleAt`) — stored as `ReminderLog.slotAt`. */
  cycleAt: number;
  /** Day number from `soonDate` (0 = the first nudge). */
  seq: number;
  at: number;
}

/**
 * The nudge instant on local date `date`: the care time; a one-off with a time
 * is nudged an hour before it on its day when that is earlier.
 */
function nudgeAt(s: Schedule, st: CareStatus, date: string, remindTime: string): number {
  const at = zonedToUtc(date, remindTime, s.timezone);
  if (st.dueAt !== null && date === st.dueDate) return Math.min(at, st.dueAt - HOUR);
  return at;
}

/**
 * Daily nudges in (from, to] for one care schedule: one per local day from
 * `soonDate` on, while it is not done. Nothing for other modes.
 */
export function careReminderEvents(args: {
  schedule: Schedule;
  lastAt: number | null;
  anchor: number;
  /** "HH:MM" (the user's `careRemindTime`). */
  remindTime: string;
  from: number;
  to: number;
}): CareEvent[] {
  const { schedule: s, lastAt, anchor, remindTime, from, to } = args;
  const st = careStatus(s, lastAt, anchor, to);
  if (!st || !isCareDue(st.state)) return [];
  const out: CareEvent[] = [];
  const last = localDate(to, s.timezone);
  let date = maxDate(st.soonDate, addDays(localDate(from, s.timezone), -1));
  for (; date <= last; date = addDays(date, 1)) {
    const at = nudgeAt(s, st, date, remindTime);
    if (at > from && at <= to) out.push({ cycleAt: st.cycleAt, seq: daysBetween(st.soonDate, date), at });
  }
  return out;
}

/**
 * The care item belongs in the person's care notification at `to`: it is due
 * (soon / today / overdue) and its first nudge has happened. Null when not.
 */
export function careOpen(args: {
  schedule: Schedule;
  lastAt: number | null;
  anchor: number;
  remindTime: string;
  to: number;
}): CareStatus | null {
  const st = careStatus(args.schedule, args.lastAt, args.anchor, args.to);
  if (!st || !isCareDue(st.state)) return null;
  return nudgeAt(args.schedule, st, st.soonDate, args.remindTime) <= args.to ? st : null;
}
