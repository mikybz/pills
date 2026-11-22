import { formatAmount, formatDays, formatList, formatLocalDate, isCountUnit, weekdayName } from "@/lib/format";
import { sortTimes } from "@/lib/schedule";
import { kindOf, parseTimes, parseWeekdays, type MedicineDTO } from "@/lib/types";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A schedule in words: "Twice a day, 08:00 and 20:00", "Mon and Thu, 08:00", "At the latest every 2 weeks". */
export function describeSchedule(
  m: Pick<MedicineDTO, "mode" | "times" | "intervalH" | "maxPerDay" | "unit" | "endsOn"> &
    Partial<Pick<MedicineDTO, "kind" | "weekdays" | "everyDays" | "maxDays" | "minDays" | "dueOn">>,
  t: Translate,
  locale: string,
): string {
  let text: string;
  const times = sortTimes(parseTimes(m.times));
  const weekdays = parseWeekdays(m.weekdays);
  if (m.mode === "fixed" && weekdays) {
    const days = weekdays.length === 7 ? t("describe.everyDay") : formatList(weekdays.map((d) => weekdayName(d, locale)), locale);
    text = t("describe.onDays", { days, times: formatList(times, locale) });
  } else if (m.mode === "fixed" && m.everyDays && m.everyDays > 1) {
    text = t("describe.everyDays", { count: m.everyDays, times: formatList(times, locale) });
  } else if (m.mode === "fixed") {
    text = t("describe.fixed", { count: times.length, times: formatList(times, locale) });
  } else if (m.mode === "interval") {
    text = t("describe.interval", { hours: formatAmount(m.intervalH ?? 0) });
  } else if (m.mode === "flex") {
    const max = formatDays(m.maxDays ?? 1, t);
    text = m.minDays ? t("describe.flexRange", { min: formatDays(m.minDays, t), max }) : t("describe.flex", { max });
  } else if (m.mode === "once") {
    const date = m.dueOn ? formatLocalDate(m.dueOn, locale) : "";
    text = times[0] ? t("describe.onceAt", { date, time: times[0] }) : t("describe.once", { date });
  } else if (kindOf(m) !== "medicine") {
    text = t("describe.anyTime");
  } else if (m.maxPerDay) {
    text = t("describe.asNeededMax", { max: formatAmount(m.maxPerDay), unit: isCountUnit(m.unit) ? "" : ` ${m.unit}` });
  } else {
    text = t("describe.asNeeded");
  }
  if (m.endsOn) text += ` · ${t("describe.until", { date: m.endsOn })}`;
  return text;
}
