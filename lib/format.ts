// Pure formatting helpers shared by client and server. 24-hour clock in every
// locale (hourCycle "h23" is passed explicitly everywhere). Times are shown in the
// person's timezone when one is given.
import { addDays, localDate } from "./tz";

type Translate = (key: string, values?: Record<string, string | number>) => string;

const tag = (locale: string) => (locale === "nb" ? "nb-NO" : "en-GB");

export function formatTime(d: Date | number, locale: string, timeZone?: string) {
  return new Intl.DateTimeFormat(tag(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(d);
}

export function formatDay(d: Date | number, locale: string, timeZone?: string) {
  return new Intl.DateTimeFormat(tag(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  }).format(d);
}

export function formatDateTime(d: Date | number, locale: string, timeZone?: string) {
  return `${formatDay(d, locale, timeZone)} ${formatTime(d, locale, timeZone)}`;
}

export function formatMonth(d: Date | number, locale: string, withYear: boolean, timeZone?: string) {
  return new Intl.DateTimeFormat(tag(locale), {
    month: "short",
    ...(withYear ? { year: "2-digit" } : {}),
    timeZone,
  }).format(d);
}

/** "today" / "yesterday" / "on Wed 12 Nov": the local day of `at`, relative to `now`. */
export function formatDayWord(at: number, now: number, locale: string, timeZone: string, t: Translate) {
  const day = localDate(at, timeZone);
  const today = localDate(now, timeZone);
  if (day === today) return t("day.today");
  if (day === addDays(today, -1)) return t("day.yesterday");
  return t("day.on", { date: formatDay(at, locale, timeZone) });
}

/** "20:00" today, "yesterday 20:00", "Wed 12 Nov 20:00" otherwise. */
export function formatWhen(at: number, now: number, locale: string, timeZone: string, t: Translate) {
  const day = localDate(at, timeZone);
  const today = localDate(now, timeZone);
  const time = formatTime(at, locale, timeZone);
  if (day === today) return time;
  if (day === addDays(today, -1)) return t("day.yesterdayAt", { time });
  return `${formatDay(at, locale, timeZone)} ${time}`;
}

/** "08:00 and 20:00" / "08:00 og 20:00". */
export function formatList(items: string[], locale: string) {
  return new Intl.ListFormat(tag(locale), { style: "long", type: "conjunction" }).format(items);
}

/** "2 h ago" style relative time. */
export function formatRelative(d: Date | number, locale: string, now: number) {
  const rtf = new Intl.RelativeTimeFormat(tag(locale), { numeric: "auto" });
  const diffMin = Math.round((+d - now) / 60_000);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffH = Math.round(diffMin / 60);
  if (Math.abs(diffH) < 24) return rtf.format(diffH, "hour");
  return rtf.format(Math.round(diffH / 24), "day");
}

/** Format an amount without trailing zeros: 0.5, 1, 1.25 */
export function formatAmount(n: number) {
  return Number(n.toFixed(3)).toString();
}

/** Counted units are words ("2 tablets", "1 application"), not abbreviations. */
export function isCountUnit(unit: string): unit is "pcs" | "appl" {
  return unit === "pcs" || unit === "appl";
}

/** "1 tablet", "2 tablets", "1 application", "5 mg". `t` is a translator rooted at the message catalog. */
export function formatDose(amount: number, unit: string, t: Translate) {
  if (isCountUnit(unit)) return t(`units.${unit}`, { count: amount, amount: formatAmount(amount) });
  return `${formatAmount(amount)} ${unit}`;
}

/** Unit name for pickers ("tablets" for pcs, "applications" for appl). */
export function unitLabel(unit: string, t: Translate) {
  return isCountUnit(unit) ? t(`units.${unit}Name`) : unit;
}

/** "1 h 20 min" / "40 min". */
export function formatDuration(ms: number, t: Translate) {
  const total = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return t("duration.hm", { h, m });
  if (h) return t("duration.h", { h });
  return t("duration.m", { m });
}
