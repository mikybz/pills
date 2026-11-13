/**
 * Pure scheduling model (no I/O, no clock). Used by the client (checklist,
 * history), the API (assigning `slotAt` on write) and the reminder tick.
 *
 * Instants are epoch milliseconds. See REWRITE.md section 3 for the rules.
 */
import { addDays, localDate, startOfLocalDay, zonedToUtc } from "./tz";

export type Mode = "fixed" | "interval" | "asNeeded";
export type DoseStatus = "taken" | "uncertain" | "skipped";

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** A log within this distance of "now" is a tap (tap rule); otherwise backdated (window rule). */
export const TAP_TOLERANCE_MS = 2 * MIN;

/** Usual awake hours, "HH:MM" wall clock in the schedule's time zone; may wrap midnight. */
export interface DayWindow {
  wake: string;
  bed: string;
}

export const DEFAULT_DAY: DayWindow = { wake: "07:00", bed: "23:00" };

export interface Schedule {
  mode: Mode;
  /** Fixed mode: sorted "HH:MM" wall-clock times in `timezone`. */
  times: string[];
  /** Interval mode: hours between doses. */
  intervalH: number | null;
  /** Inclusive local dates "YYYY-MM-DD". */
  startsOn: string | null;
  endsOn: string | null;
  /** Doctor's minimum gap; overrides the default (half the gap to the next slot). */
  minIntervalMin: number | null;
  timezone: string;
  /** The person's day window; null when the medicine is taken around the clock. */
  day: DayWindow | null;
  /** Late-dose drift (fixed mode): a late dose moves the next slot. */
  drift: boolean;
}

export interface LogEntry {
  id?: string;
  takenAt: number;
  slotAt: number | null;
  status: DoseStatus;
  amount: number;
  /**
   * Logged before the medicine had a reviewed schedule (slotAt is null). Such a log
   * fills the slot whose window contains its takenAt, so rollout day is not
   * shown as overdue for doses already taken.
   */
  legacy?: boolean;
}

export type SlotState =
  | "upcoming"
  | "due"
  | "overdue"
  | "missed"
  | "taken"
  | "skipped"
  /** Past its cutoff, but before missed slots are derived (unreviewed / pre-review). */
  | "lapsed";

export interface Slot {
  /** Nominal scheduled instant — the identity stored in `DoseLog.slotAt`. */
  slotAt: number;
  /** After the push rule; equals slotAt unless the previous dose came late. */
  effectiveAt: number;
  /** Past this instant an unlogged slot is missed. Infinity in interval mode. */
  cutoff: number;
  /** Logs at or after this instant (and before `cutoff`) belong to this slot. */
  windowStart: number;
  minGap: number;
  state: SlotState;
  /** The log that fills the slot (taken/uncertain preferred over skipped). */
  log: LogEntry | null;
}

export function isTakenStatus(s: DoseStatus) {
  return s === "taken" || s === "uncertain";
}

export function isScheduled(mode: string | null | undefined): mode is "fixed" | "interval" {
  return mode === "fixed" || mode === "interval";
}

/* ------------------------------------------------------------------ bounds */

export function inBounds(s: Schedule, at: number): boolean {
  if (!s.startsOn && !s.endsOn) return true;
  const d = localDate(at, s.timezone);
  return (!s.startsOn || d >= s.startsOn) && (!s.endsOn || d <= s.endsOn);
}

/** True when the course is over: `now` is after the last local day `endsOn`. */
export function isFinished(s: Pick<Schedule, "endsOn" | "timezone">, now: number): boolean {
  return !!s.endsOn && localDate(now, s.timezone) > s.endsOn;
}

/* -------------------------------------------------------------- fixed mode */

/** Raw clock slots in [from, to], ignoring start/end bounds. Deduped (DST), sorted. */
function fixedRaw(s: Schedule, from: number, to: number): number[] {
  if (!s.times.length) return [];
  const out = new Set<number>();
  const last = addDays(localDate(to, s.timezone), 1);
  for (let date = addDays(localDate(from, s.timezone), -1); date <= last; date = addDays(date, 1)) {
    for (const t of s.times) {
      const at = zonedToUtc(date, t, s.timezone);
      if (at >= from && at <= to) out.add(at);
    }
  }
  return [...out].sort((a, b) => a - b);
}

interface Frame {
  slotAt: number;
  nextAt: number;
  minGap: number;
  cutoff: number;
  windowStart: number;
}

function fixedFrames(s: Schedule, from: number, to: number): Frame[] {
  const raw = fixedRaw(s, from - 3 * DAY, to + 3 * DAY);
  const gapAfter = (i: number) =>
    s.minIntervalMin ? s.minIntervalMin * MIN : (raw[i + 1] - raw[i]) / 2;
  const frames: Frame[] = [];
  for (let i = 1; i < raw.length - 1; i++) {
    const slotAt = raw[i];
    if (slotAt < from || slotAt > to || !inBounds(s, slotAt)) continue;
    const minGap = gapAfter(i);
    frames.push({
      slotAt,
      nextAt: raw[i + 1],
      minGap,
      cutoff: Math.max(slotAt, raw[i + 1] - minGap),
      windowStart: Math.max(raw[i - 1], slotAt - gapAfter(i - 1)),
    });
  }
  return frames;
}

/** Which log fills each slot: its `slotAt`, or (legacy logs only) the window containing `takenAt`. */
function fillLogs(frames: Frame[], logs: LogEntry[]): Map<number, LogEntry> {
  const bySlot = new Map<number, LogEntry[]>();
  const slotSet = new Set(frames.map((f) => f.slotAt));
  for (const log of logs) {
    let key: number | null = null;
    if (log.slotAt !== null) {
      if (slotSet.has(log.slotAt)) key = log.slotAt;
    } else if (log.legacy) {
      const f = frames.find((fr) => log.takenAt >= fr.windowStart && log.takenAt < fr.cutoff);
      if (f) key = f.slotAt;
    }
    if (key === null) continue;
    const list = bySlot.get(key) ?? [];
    list.push(log);
    bySlot.set(key, list);
  }
  const fill = new Map<number, LogEntry>();
  for (const [key, list] of bySlot) {
    const taken = list.filter((l) => isTakenStatus(l.status)).sort((a, b) => a.takenAt - b.takenAt);
    fill.set(key, taken[taken.length - 1] ?? list[0]);
  }
  return fill;
}

export interface StateOptions {
  now: number;
  leadMin: number;
  /** Unlogged slots at/after this instant become "missed" past their cutoff; null = never. */
  missedFrom: number | null;
}

function stateOf(
  slot: Omit<Slot, "state">,
  { now, leadMin, missedFrom }: StateOptions,
): SlotState {
  if (slot.log) return isTakenStatus(slot.log.status) ? "taken" : "skipped";
  if (now < slot.effectiveAt - leadMin * MIN) return "upcoming";
  if (now < slot.effectiveAt) return "due";
  if (now < slot.cutoff) return "overdue";
  return missedFrom !== null && slot.slotAt >= missedFrom ? "missed" : "lapsed";
}

/**
 * Fixed-mode slots with slotAt in [from, to], filled from the logs, with the
 * push rule applied: a dose taken at t moves the *next* slot to
 * max(nextSlotAt, t + minGap). Only that one slot moves.
 */
export function fixedSlots(
  s: Schedule,
  logs: LogEntry[],
  from: number,
  to: number,
  opts: StateOptions,
): Slot[] {
  const frames = fixedFrames(s, from - 2 * DAY, to + 2 * DAY);
  const fill = fillLogs(frames, logs);
  const out: Slot[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    let effectiveAt = f.slotAt;
    const prev = frames[i - 1];
    const prevLog = prev && prev.nextAt === f.slotAt ? fill.get(prev.slotAt) : undefined;
    if (prevLog && isTakenStatus(prevLog.status)) {
      effectiveAt = Math.max(f.slotAt, prevLog.takenAt + prev.minGap);
    }
    if (f.slotAt < from || f.slotAt > to) continue;
    const base = {
      slotAt: f.slotAt,
      effectiveAt,
      cutoff: Math.max(f.cutoff, effectiveAt),
      windowStart: f.windowStart,
      minGap: f.minGap,
      log: fill.get(f.slotAt) ?? null,
    };
    out.push({ ...base, state: stateOf(base, opts) });
  }
  return out;
}

/* ----------------------------------------------------------- interval mode */

/**
 * Next due instant in interval mode: last taken dose + interval; a skip
 * advances from its slotAt. With no dose yet, due at `anchor` (or startsOn).
 * Null when past endsOn. Only logs with base time < `before` are considered.
 */
export function intervalNextDue(
  s: Schedule,
  logs: LogEntry[],
  anchor: number,
  before = Infinity,
): number | null {
  if (!s.intervalH || s.intervalH <= 0) return null;
  const iv = s.intervalH * HOUR;
  let next: number | null = null;
  for (const l of logs) {
    const base = l.status === "skipped" ? (l.slotAt ?? l.takenAt) : l.takenAt;
    if (base >= before) continue;
    next = Math.max(next ?? -Infinity, base + iv);
  }
  if (next === null) next = anchor;
  if (s.startsOn) next = Math.max(next, startOfLocalDay(s.startsOn, s.timezone));
  if (s.endsOn && next >= startOfLocalDay(addDays(s.endsOn, 1), s.timezone)) return null;
  return next;
}

export function intervalMinGap(s: Schedule) {
  return s.minIntervalMin ? s.minIntervalMin * MIN : ((s.intervalH ?? 0) * HOUR) / 2;
}

/** The one pending interval slot (never missed: overdue until logged). */
export function intervalSlot(
  s: Schedule,
  logs: LogEntry[],
  anchor: number,
  opts: StateOptions,
): Slot | null {
  const next = intervalNextDue(s, logs, anchor);
  if (next === null) return null;
  const base = {
    slotAt: next,
    effectiveAt: next,
    cutoff: Infinity,
    windowStart: -Infinity,
    minGap: intervalMinGap(s),
    log: null,
  };
  return { ...base, state: stateOf(base, opts) };
}

/* ------------------------------------------------------- slot assignment */

/** Min gap that applies around a dose filling `slotAt` (or taken at `at`). */
export function minGapFor(s: Schedule, slotAt: number | null, at: number): number {
  if (s.mode === "interval") return intervalMinGap(s);
  if (s.mode !== "fixed") return s.minIntervalMin ? s.minIntervalMin * MIN : 0;
  const ref = slotAt ?? at;
  const frames = fixedFrames(s, ref - 2 * DAY, ref + 2 * DAY);
  const f =
    frames.find((fr) => fr.slotAt === slotAt) ??
    frames.find((fr) => at >= fr.windowStart && at < fr.cutoff) ??
    frames[0];
  return f ? f.minGap : s.minIntervalMin ? s.minIntervalMin * MIN : 0;
}

/**
 * The slot a log answers when the user didn't pick a row.
 * - Tap (at ≈ now): the oldest due/overdue slot; else the next slot (taken early,
 *   next slot only). A missed slot is never filled by a tap.
 * - Backdated: the slot whose window contains `at`. Exception: when that would
 *   make the dose an early dose for a slot on a later local day ("yesterday
 *   21:00" landing in today's once-daily slot), it answers the previous slot
 *   instead if that one is still open (a late dose), else no slot (an extra dose).
 *   A backdated fact about yesterday never hides today's dose.
 */
export function assignSlot(
  s: Schedule,
  logs: LogEntry[],
  at: number,
  now: number,
  opts: { leadMin: number; anchor: number; rule?: "auto" | "window" },
): number | null {
  const tap = opts.rule !== "window" && Math.abs(now - at) <= TAP_TOLERANCE_MS;
  if (s.mode === "interval") {
    return tap ? intervalNextDue(s, logs, opts.anchor) : intervalNextDue(s, logs, opts.anchor, at);
  }
  if (s.mode !== "fixed") return null;
  const stateOpts = { now, leadMin: opts.leadMin, missedFrom: null };
  if (tap) {
    const slots = fixedSlots(s, logs, now - 2 * DAY, now + 2 * DAY, stateOpts);
    const open = slots.find((sl) => sl.state === "due" || sl.state === "overdue");
    if (open) return open.slotAt;
    return slots.find((sl) => sl.effectiveAt > now)?.slotAt ?? null;
  }
  const slots = fixedSlots(s, logs, at - 2 * DAY, at + 2 * DAY, stateOpts);
  const w = slots.find((sl) => at >= sl.windowStart && at < sl.cutoff);
  if (!w) return null;
  if (at < w.slotAt && localDate(w.slotAt, s.timezone) > localDate(at, s.timezone)) {
    const prev = slots.filter((sl) => sl.slotAt <= at).pop();
    return prev && !prev.log ? prev.slotAt : null;
  }
  return w.slotAt;
}

/* ---------------------------------------------------------------- reminders */

export interface ReminderSettings {
  /** Heads-up minutes before; 0 = off. */
  leadMin: number;
  /** Repeat interval; 0 = no repeats. */
  nagEveryMin: number;
  /** Stop repeating this long after the slot. */
  nagMaxMin: number;
}

export interface Snooze {
  slotAt: number;
  until: number;
  seq: number;
}

export type ReminderKind = "headsUp" | "due" | "nag";

export interface ReminderEvent {
  slotAt: number;
  effectiveAt: number;
  kind: ReminderKind;
  seq: number;
  at: number;
}

/** A reminder at the end of a snooze is a "nag" with seq SNOOZE_SEQ_BASE + snooze seq. */
export const SNOOZE_SEQ_BASE = 1000;

/**
 * Reminder events for one medicine and one user falling in (from, to].
 * Nothing for unlogged-but-reviewed slots only; nothing once a slot has any log;
 * nothing for a snoozed slot before the snooze ends; nothing past the cutoff.
 */
export function reminderEvents(args: {
  schedule: Schedule;
  logs: LogEntry[];
  /** Interval mode: due time of the very first dose. */
  anchor: number;
  /** Reminders only for slots at/after this instant; null = not reviewed → none. */
  remindFrom: number | null;
  settings: ReminderSettings;
  snoozes: Snooze[];
  from: number;
  to: number;
}): ReminderEvent[] {
  const { schedule: s, logs, settings, snoozes, from, to, remindFrom } = args;
  if (remindFrom === null || !isScheduled(s.mode)) return [];
  const lead = Math.max(0, settings.leadMin) * MIN;
  const every = Math.max(0, settings.nagEveryMin) * MIN;
  const maxNag = Math.max(0, settings.nagMaxMin) * MIN;
  const opts = { now: to, leadMin: 0, missedFrom: null };

  let slots: Slot[];
  if (s.mode === "fixed") {
    slots = fixedSlots(s, logs, from - maxNag - 2 * HOUR, to + lead + HOUR, opts);
  } else {
    const one = intervalSlot(s, logs, args.anchor, opts);
    slots = one ? [one] : [];
  }

  const events: ReminderEvent[] = [];
  for (const slot of slots) {
    if (slot.log || slot.slotAt < remindFrom) continue;
    const E = slot.effectiveAt;
    const mine = snoozes.filter((z) => z.slotAt === slot.slotAt);
    const candidates: ReminderEvent[] = [];
    const push = (kind: ReminderKind, seq: number, at: number) =>
      candidates.push({ slotAt: slot.slotAt, effectiveAt: E, kind, seq, at });
    if (lead > 0) push("headsUp", 0, E - lead);
    push("due", 0, E);
    if (every > 0) for (let k = 1; k * every <= maxNag; k++) push("nag", k, E + k * every);
    for (const z of mine) push("nag", SNOOZE_SEQ_BASE + z.seq, z.until);
    for (const ev of candidates) {
      if (ev.at <= from || ev.at > to || ev.at >= slot.cutoff) continue;
      if (mine.some((z) => ev.at < z.until && !(ev.seq === SNOOZE_SEQ_BASE + z.seq))) continue;
      events.push(ev);
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

/* ------------------------------------------------------------------ history */

export interface Segment {
  schedule: Schedule;
  /** [from, to): the period this schedule was in force (from = reviewed / changed). */
  from: number;
  to: number;
}

export interface HistorySlot extends Slot {
  mode: "fixed" | "interval";
}

/**
 * Slots for history in [rangeFrom, rangeTo): fixed slots (incl. missed) per
 * schedule segment, and interval slots answered by logs. Missed slots are only
 * derived inside segments, i.e. from scheduleReviewedAt onward.
 */
export function historySlots(
  segments: Segment[],
  logs: LogEntry[],
  rangeFrom: number,
  rangeTo: number,
  now: number,
): HistorySlot[] {
  const out: HistorySlot[] = [];
  for (const seg of segments) {
    const lo = Math.max(seg.from, rangeFrom);
    const hi = Math.min(seg.to, rangeTo);
    if (lo >= hi) continue;
    if (seg.schedule.mode === "fixed") {
      const opts = { now, leadMin: 0, missedFrom: seg.from };
      for (const sl of fixedSlots(seg.schedule, logs, lo, hi, opts)) {
        if (sl.slotAt >= lo && sl.slotAt < hi) out.push({ ...sl, mode: "fixed" });
      }
    } else if (seg.schedule.mode === "interval") {
      for (const l of logs) {
        if (l.slotAt === null || l.slotAt < lo || l.slotAt >= hi) continue;
        out.push({
          slotAt: l.slotAt,
          effectiveAt: l.slotAt,
          cutoff: Infinity,
          windowStart: -Infinity,
          minGap: intervalMinGap(seg.schedule),
          log: l,
          state: isTakenStatus(l.status) ? "taken" : "skipped",
          mode: "interval",
        });
      }
    }
  }
  return out.sort((a, b) => a.slotAt - b.slotAt);
}

/* ----------------------------------------------------------- form helpers */

export const DEFAULT_TIMES: Record<number, string[]> = {
  1: ["08:00"],
  2: ["08:00", "20:00"],
  3: ["07:00", "15:00", "23:00"],
  4: ["06:00", "12:00", "18:00", "00:00"],
};

export function minutesOf(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function timeOf(minutes: number) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** `count` evenly spaced times starting at `first` (entry order, not sorted). */
export function evenlySpaced(first: string, count: number, stepH = 24 / count): string[] {
  const start = minutesOf(first);
  return Array.from({ length: count }, (_, i) => timeOf(start + i * stepH * 60));
}

export function sortTimes(times: string[]) {
  return [...new Set(times)].sort();
}

/** 23:00–06:00 counts as night (for the plain hint in the form). */
export function isNight(time: string) {
  const m = minutesOf(time);
  return m >= 23 * 60 || m < 6 * 60;
}

/* -------------------------------------------------------------- day window */

/** Awake length in minutes: (bed − wake) mod 24 h. Both ends count as awake. */
export function awakeMinutes(day: DayWindow) {
  return (((minutesOf(day.bed) - minutesOf(day.wake)) % 1440) + 1440) % 1440;
}

/** A day window is valid when the awake part is between 6 h and 23 h. */
export function validDayWindow(day: DayWindow) {
  const ok = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!ok.test(day.wake) || !ok.test(day.bed)) return false;
  const awake = awakeMinutes(day);
  return awake >= 6 * 60 && awake <= 23 * 60;
}
