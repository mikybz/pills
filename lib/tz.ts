/**
 * Pure timezone helpers on top of Intl (no I/O, no dependencies). Shared by the
 * client and the server. All instants are epoch milliseconds; local dates are
 * "YYYY-MM-DD" and local times "HH:MM" in an IANA zone.
 */

const MIN = 60_000;
const DAY = 86_400_000;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string) {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

export interface WallParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

export function wallParts(ms: number, tz: string): WallParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, hh: out.hour % 24, mm: out.minute, ss: out.second };
}

/** UTC offset of `tz` at instant `ms`, in ms (Oslo winter: +3 600 000). */
export function offsetMs(ms: number, tz: string): number {
  const p = wallParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date of an instant. */
export function localDate(ms: number, tz: string): string {
  const p = wallParts(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Local "HH:MM" of an instant. */
export function localTime(ms: number, tz: string): string {
  const p = wallParts(ms, tz);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

/** Minutes since local midnight. */
export function localMinutes(ms: number, tz: string): number {
  const p = wallParts(ms, tz);
  return p.hh * 60 + p.mm;
}

function parseDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

export function parseTime(time: string) {
  const [hh, mm] = time.split(":").map(Number);
  return { hh, mm };
}

/** Calendar arithmetic on local dates. */
export function addDays(date: string, n: number): string {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / DAY);
}

/** Day of week of a local date, 0 = Monday … 6 = Sunday. */
export function weekdayMon0(date: string): number {
  const { y, m, d } = parseDate(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * Wall-clock time in `tz` → UTC instant.
 * - Fall-back day: a repeated time resolves to its first occurrence.
 * - Spring-forward day: a nonexistent time moves to the next valid minute
 *   (Oslo 02:30 on the last Sunday of March → 03:00).
 */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const { y, m, d } = parseDate(date);
  const { hh, mm } = parseTime(time);
  const L = Date.UTC(y, m - 1, d, hh, mm);
  const before = offsetMs(L - DAY, tz);
  const after = offsetMs(L + DAY, tz);
  const candidates = [L - before, L - after].filter((t) => t + offsetMs(t, tz) === L);
  if (candidates.length) return Math.min(...candidates);
  // Inside a spring-forward gap: find the transition instant (minute resolution).
  let lo = Math.min(L - before, L - after);
  let hi = Math.max(L - before, L - after);
  const loOffset = offsetMs(lo, tz);
  while (hi - lo > MIN) {
    const mid = lo + Math.floor((hi - lo) / 2 / MIN) * MIN;
    if (offsetMs(mid, tz) === loOffset) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Instant of local midnight starting `date`. */
export function startOfLocalDay(date: string, tz: string): number {
  return zonedToUtc(date, "00:00", tz);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_TIMEZONE = "Europe/Oslo";
