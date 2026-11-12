/**
 * Pure schedule guess for medicines that predate schedules (REWRITE.md §8).
 * The result is reviewed by the user before any reminder or missed dose is derived.
 */
import { DEFAULT_TIMES, DAY, isTakenStatus, timeOf, type DoseStatus, type Mode } from "./schedule";
import { daysBetween, localDate, localMinutes } from "./tz";

export interface GuessInput {
  presets: number[];
  defaultPreset: number | null;
  maxPerIntake: number | null;
  maxPerDay: number | null;
  archived: boolean;
  logs: { takenAt: number; status: DoseStatus }[];
  timezone: string;
  now: number;
}

export interface Guess {
  mode: Mode;
  doseAmount: number;
  times: string[] | null;
  /** Archived medicines need no review. */
  reviewed: boolean;
}

const WINDOW_DAYS = 14;
const MAX_SPREAD_MIN = 90;

export function guessSchedule(input: GuessInput): Guess {
  const doseAmount = input.defaultPreset ?? input.presets[0] ?? 1;
  const asNeeded: Guess = { mode: "asNeeded", doseAmount, times: null, reviewed: input.archived };
  if (input.archived) return asNeeded;

  const tz = input.timezone;
  const logs = input.logs
    .filter((l) => isTakenStatus(l.status))
    .filter((l) => l.takenAt <= input.now && input.now - l.takenAt < WINDOW_DAYS * DAY)
    .sort((a, b) => a.takenAt - b.takenAt);
  if (logs.length < 5) return asNeeded;

  const perDay = new Map<string, number>();
  for (const l of logs) {
    const d = localDate(l.takenAt, tz);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const n = input.maxPerDay
    ? Math.round(input.maxPerDay / (input.maxPerIntake ?? doseAmount))
    : median([...perDay.values()]);
  if (!Number.isInteger(n) || n < 1 || n > 4) return asNeeded;

  const spanDays = daysBetween(localDate(logs[0].takenAt, tz), localDate(input.now, tz)) + 1;
  if (logs.length / spanDays < 0.7 * n) return asNeeded;

  return { mode: "fixed", doseAmount, times: clusterTimes(logs.map((l) => localMinutes(l.takenAt, tz)), n), reviewed: false };
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Groups minutes-of-day into `n` clusters (circular: 23:50 and 00:10 are close),
 * rounds each cluster median to 30 min. Falls back to the default times for `n`
 * when a cluster spreads more than ±90 min or two clusters round to the same time.
 */
export function clusterTimes(minutes: number[], n: number): string[] {
  const fallback = [...DEFAULT_TIMES[n]].sort();
  const xs = unwrap([...minutes].sort((a, b) => a - b));
  if (xs.length < n) return fallback;
  const groups = partition(xs, n);
  const times: string[] = [];
  for (const g of groups) {
    const med = medianFloat(g);
    if (g.some((x) => Math.abs(x - med) > MAX_SPREAD_MIN)) return fallback;
    times.push(timeOf(Math.round(med / 30) * 30));
  }
  const sorted = [...new Set(times)].sort();
  return sorted.length === n ? sorted : fallback;
}

function medianFloat(xs: number[]) {
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** Cut the circle at its largest gap so close times across midnight stay together. */
function unwrap(sorted: number[]): number[] {
  if (sorted.length < 2) return sorted;
  let cut = sorted.length - 1; // gap between last and first (+1440)
  let best = sorted[0] + 1440 - sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const g = sorted[i + 1] - sorted[i];
    if (g > best) {
      best = g;
      cut = i;
    }
  }
  if (cut === sorted.length - 1) return sorted;
  return [...sorted.slice(cut + 1), ...sorted.slice(0, cut + 1).map((x) => x + 1440)];
}

/** Optimal split of a sorted list into `k` contiguous groups (min. squared error). */
function partition(xs: number[], k: number): number[][] {
  const n = xs.length;
  const pre = [0];
  const pre2 = [0];
  for (const x of xs) {
    pre.push(pre[pre.length - 1] + x);
    pre2.push(pre2[pre2.length - 1] + x * x);
  }
  const cost = (i: number, j: number) => {
    const c = j - i + 1;
    const s = pre[j + 1] - pre[i];
    return pre2[j + 1] - pre2[i] - (s * s) / c;
  };
  const dp = Array.from({ length: k + 1 }, () => new Array<number>(n).fill(Infinity));
  const from = Array.from({ length: k + 1 }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) dp[1][j] = cost(0, j);
  for (let c = 2; c <= k; c++) {
    for (let j = c - 1; j < n; j++) {
      for (let i = c - 1; i <= j; i++) {
        const v = dp[c - 1][i - 1] + cost(i, j);
        if (v < dp[c][j]) {
          dp[c][j] = v;
          from[c][j] = i;
        }
      }
    }
  }
  const groups: number[][] = [];
  let j = n - 1;
  for (let c = k; c >= 1; c--) {
    const i = c === 1 ? 0 : from[c][j];
    groups.unshift(xs.slice(i, j + 1));
    j = i - 1;
  }
  return groups;
}
