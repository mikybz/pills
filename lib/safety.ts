/**
 * Pure dose check (no I/O, no clock). One warning level: the app states the
 * fact and asks once ("Log anyway" / "Cancel"); it never blocks.
 *
 * - Scheduled medicines (fixed / interval): only likely double doses — the slot
 *   already has a taken/uncertain log, or the previous dose is less than
 *   minGap ago. No daily-max math.
 * - As needed: max per intake, minimum interval, and max per "day", where the
 *   day is a rolling window of 24 h minus slack (wake-up times vary).
 */
import {
  HOUR,
  MIN,
  isScheduled,
  isTakenStatus,
  minGapFor,
  type DoseStatus,
  type LogEntry,
  type Schedule,
} from "./schedule";

/** Slack subtracted from 24 h for the as-needed daily limit. Tune here. */
export const AS_NEEDED_SLACK_H = 4;
export const LIMIT_WINDOW_MS = (24 - AS_NEEDED_SLACK_H) * HOUR;

const EPS = 1e-9;

export interface Limits {
  maxPerIntake: number | null;
  maxPerDay: number | null;
  minIntervalMin: number | null;
}

export type Reason =
  | { code: "slotLogged"; takenAt: number }
  | { code: "tooSoon"; takenAt: number; minGapMin: number }
  | { code: "overIntake"; amount: number; max: number }
  | { code: "overDaily"; used: number; amount: number; max: number; windowH: number };

export interface CheckResult {
  level: "ok" | "warn";
  reasons: Reason[];
}

export interface DoseRequest {
  amount: number;
  at: number;
  status: DoseStatus;
  /** Scheduled medicines: the slot being filled. */
  slotAt: number | null;
}

function countable(logs: LogEntry[], countUncertain: boolean) {
  return logs.filter(
    (l) => l.status === "taken" || (countUncertain && l.status === "uncertain"),
  );
}

export function checkDose(args: {
  schedule: Schedule;
  limits: Limits;
  logs: LogEntry[];
  req: DoseRequest;
  /** User setting; only affects the as-needed limits. */
  countUncertain: boolean;
}): CheckResult {
  const { schedule, limits, logs, req, countUncertain } = args;
  if (req.status === "skipped") return { level: "ok", reasons: [] };
  const reasons: Reason[] = [];

  if (isScheduled(schedule.mode)) {
    const inSlot =
      req.slotAt === null
        ? []
        : logs.filter((l) => l.slotAt === req.slotAt && isTakenStatus(l.status));
    const sameSlot = inSlot.sort((a, b) => b.takenAt - a.takenAt)[0];
    if (sameSlot) reasons.push({ code: "slotLogged", takenAt: sameSlot.takenAt });

    const minGap = minGapFor(schedule, req.slotAt, req.at);
    const prev = logs
      .filter((l) => isTakenStatus(l.status) && l.takenAt <= req.at)
      .sort((a, b) => b.takenAt - a.takenAt)[0];
    if (prev && prev !== sameSlot && req.at - prev.takenAt < minGap) {
      reasons.push({ code: "tooSoon", takenAt: prev.takenAt, minGapMin: Math.round(minGap / MIN) });
    }
  } else {
    const past = countable(logs, countUncertain).filter((l) => l.takenAt <= req.at);
    if (limits.maxPerIntake && req.amount > limits.maxPerIntake + EPS) {
      reasons.push({ code: "overIntake", amount: req.amount, max: limits.maxPerIntake });
    }
    const last = past.sort((a, b) => b.takenAt - a.takenAt)[0];
    if (limits.minIntervalMin && last && req.at - last.takenAt < limits.minIntervalMin * MIN) {
      reasons.push({ code: "tooSoon", takenAt: last.takenAt, minGapMin: limits.minIntervalMin });
    }
    if (limits.maxPerDay) {
      const used = usedInWindow(past, req.at);
      if (used + req.amount > limits.maxPerDay + EPS) {
        reasons.push({
          code: "overDaily",
          used,
          amount: req.amount,
          max: limits.maxPerDay,
          windowH: LIMIT_WINDOW_MS / HOUR,
        });
      }
    }
  }
  return { level: reasons.length ? "warn" : "ok", reasons };
}

function usedInWindow(logs: LogEntry[], at: number) {
  return logs
    .filter((l) => l.takenAt <= at && at - l.takenAt < LIMIT_WINDOW_MS)
    .reduce((s, l) => s + l.amount, 0);
}

export interface AsNeededStatus {
  /** Amount counted in the limit window ending now. */
  used: number;
  max: number | null;
  lastAt: number | null;
  /** When `amount` stops tripping the time-based limits; null = free now (or never). */
  nextFreeAt: number | null;
}

/** Facts for the as-needed card: "2 of 3 used · next free at 14:30". */
export function asNeededStatus(
  limits: Limits,
  logs: LogEntry[],
  now: number,
  amount: number,
  countUncertain: boolean,
): AsNeededStatus {
  const past = countable(logs, countUncertain).filter((l) => l.takenAt <= now);
  const last = past.reduce<number | null>((m, l) => (m === null || l.takenAt > m ? l.takenAt : m), null);
  const blockedAt = (t: number) => {
    const inWindow = past.filter((l) => t - l.takenAt < LIMIT_WINDOW_MS);
    if (limits.maxPerDay && inWindow.reduce((s, l) => s + l.amount, 0) + amount > limits.maxPerDay + EPS) return true;
    if (limits.minIntervalMin && last !== null && t - last < limits.minIntervalMin * MIN) return true;
    return false;
  };
  let nextFreeAt: number | null = null;
  if (blockedAt(now)) {
    const candidates = [
      ...past.map((l) => l.takenAt + LIMIT_WINDOW_MS),
      ...(limits.minIntervalMin && last !== null ? [last + limits.minIntervalMin * MIN] : []),
    ]
      .filter((t) => t > now)
      .sort((a, b) => a - b);
    nextFreeAt = candidates.find((t) => !blockedAt(t)) ?? null;
  }
  return { used: usedInWindow(past, now), max: limits.maxPerDay, lastAt: last, nextFreeAt };
}
