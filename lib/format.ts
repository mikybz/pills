"use client";

export function formatTime(d: Date, locale: string) {
  return new Intl.DateTimeFormat(locale === "nb" ? "nb-NO" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatDay(d: Date, locale: string) {
  return new Intl.DateTimeFormat(locale === "nb" ? "nb-NO" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

/** "2 h ago" style relative time. */
export function formatRelative(d: Date, locale: string, now = new Date()) {
  const rtf = new Intl.RelativeTimeFormat(locale === "nb" ? "nb-NO" : "en", {
    numeric: "auto",
  });
  const diffMs = d.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffH = Math.round(diffMin / 60);
  if (Math.abs(diffH) < 24) return rtf.format(diffH, "hour");
  return rtf.format(Math.round(diffH / 24), "day");
}

/** Format an amount without trailing zeros: 0.5, 1, 1.25 */
export function formatAmount(n: number) {
  return Number(n.toFixed(3)).toString();
}
