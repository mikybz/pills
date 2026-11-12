import { formatAmount, formatList } from "@/lib/format";
import { sortTimes } from "@/lib/schedule";
import { parseTimes, type MedicineDTO } from "@/lib/types";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A schedule in words: "Twice a day, 08:00 and 20:00". */
export function describeSchedule(
  m: Pick<MedicineDTO, "mode" | "times" | "intervalH" | "maxPerDay" | "unit" | "endsOn">,
  t: Translate,
  locale: string,
): string {
  let text: string;
  if (m.mode === "fixed") {
    const times = sortTimes(parseTimes(m.times));
    text = t("describe.fixed", { count: times.length, times: formatList(times, locale) });
  } else if (m.mode === "interval") {
    text = t("describe.interval", { hours: formatAmount(m.intervalH ?? 0) });
  } else if (m.maxPerDay) {
    text = t("describe.asNeededMax", { max: formatAmount(m.maxPerDay), unit: m.unit === "pcs" ? "" : ` ${m.unit}` });
  } else {
    text = t("describe.asNeeded");
  }
  if (m.endsOn) text += ` · ${t("describe.until", { date: m.endsOn })}`;
  return text;
}
