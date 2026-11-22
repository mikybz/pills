import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import nb from "@/messages/nb.json";
import { formatDose, formatTime } from "@/lib/format";
import type { CareState } from "@/lib/care";
import type { ReminderKind } from "@/lib/schedule";
import type { PushPayload } from "@/lib/push";
import type { Kind } from "@/lib/types";

const catalogs = { en, nb } as const;

export function translatorFor(locale: string) {
  const l = locale === "nb" ? "nb" : "en";
  const t = createTranslator({ locale: l, messages: catalogs[l] });
  return { locale: l, t: t as unknown as (key: string, values?: Record<string, string | number>) => string };
}

export interface ReminderItem {
  medicineId: string;
  name: string;
  amount: number;
  unit: string;
  /** Medicine form: creams are "applied", not "taken". */
  form: string;
  /** Measurements are "measured" and can't be logged from the notification (they need a value). */
  itemKind?: Kind;
  slotAt: number;
  /** When this slot is due (drift / push applied). */
  effectiveAt: number;
  /** The latest reminder of this slot: decides its wording. */
  kind: ReminderKind;
}

/** The one reminder notification of a person: every slot still unanswered. */
export function reminderTag(personId: string) {
  return `reminders:${personId}`;
}

/**
 * One notification per person, in the receiving user's language, listing every
 * slot still unanswered. The tag (`reminderTag`) makes a later reminder replace
 * the earlier one instead of stacking. One due instant reads as a sentence; several
 * read as one line per instant ("08:00 Ibux, 1 tablet").
 */
export function reminderPayload(args: {
  locale: string;
  person: { id: string; name: string; timezone: string };
  /** Prefix the person's name (another person or a pet). */
  forOther: boolean;
  leadMin: number;
  items: ReminderItem[];
  /** Replace what is on screen without a new alert. */
  update?: boolean;
}): PushPayload {
  const { t, locale } = translatorFor(args.locale);
  const items = [...args.items].sort((a, b) => a.effectiveAt - b.effectiveAt || a.slotAt - b.slotAt);
  const isMeasure = (i: ReminderItem) => i.itemKind === "measure";
  const doseText = (list: ReminderItem[]) =>
    list.map((i) => (isMeasure(i) ? i.name : `${i.name}, ${formatDose(i.amount, i.unit, t)}`)).join("; ");
  const verbOf = (list: ReminderItem[]) =>
    list.every(isMeasure) ? "measure" : list.every((i) => i.form === "cream" && !isMeasure(i)) ? "apply" : "take";
  const timeOf = (at: number) => formatTime(at, locale, args.person.timezone);

  const instants = [...new Set(items.map((i) => i.effectiveAt))];
  let title = t("app.name");
  let body: string;
  if (instants.length === 1) {
    const verb = verbOf(items);
    const kind = items[0].kind;
    body =
      kind === "headsUp"
        ? t("push.headsUp", { minutes: args.leadMin, doses: doseText(items) })
        : kind === "due"
          ? t("push.due", { doses: doseText(items), verb })
          : t("push.nag", { names: items.map((i) => i.name).join(", "), time: timeOf(instants[0]), verb });
    if (args.forOther) body = t("push.forOther", { name: args.person.name, text: lowerFirst(body, locale) });
  } else {
    if (args.forOther) title = args.person.name;
    body = instants
      .map((at) => `${timeOf(at)} ${doseText(items.filter((i) => i.effectiveAt === at))}`)
      .join("\n");
  }
  // "Taken" logs the doses only: a measurement needs a value, so it opens the app.
  const loggable = items.filter((i) => !isMeasure(i));
  const verb = verbOf(loggable.length ? loggable : items);
  return {
    kind: args.update ? "update" : undefined,
    title,
    body,
    tag: reminderTag(args.person.id),
    renotify: !args.update,
    silent: args.update || undefined,
    actions: [
      ...(loggable.length ? [{ action: "taken", title: t("push.actionTaken", { verb }) }] : []),
      { action: "snooze", title: t("push.actionSnooze") },
    ],
    data: {
      url: `/?person=${encodeURIComponent(args.person.id)}`,
      personId: args.person.id,
      items: items.map((i) => ({
        medicineId: i.medicineId,
        slotAt: new Date(i.slotAt).toISOString(),
        amount: i.amount,
        ...(isMeasure(i) ? { measure: true } : {}),
      })),
    },
  };
}

/** Everything in the notification with this tag is answered: take it away. */
export function closePayload(locale: string, tag: string): PushPayload {
  const { t } = translatorFor(locale);
  return { kind: "close", title: t("app.name"), body: "", tag };
}

/** The care notification of a person (tasks, to-dos, measurements due by a date). */
export function careTag(personId: string) {
  return `care:${personId}`;
}

export interface CareItem {
  medicineId: string;
  name: string;
  itemKind: Kind;
  state: CareState;
  daysLeft: number;
  /** A one-off with a time: when it is due. */
  dueAt: number | null;
  /** The cycle's identity (`ReminderLog.slotAt`, the service worker's `slotAt`). */
  cycleAt: number;
}

/**
 * One care notification per person, one line per item due: "Cut claws: 2 days
 * left", "Wash: due today", "Vet: today at 10:30", "Weigh: 3 days overdue".
 * Its Done action logs the tasks (measurements need a value: tap opens the app).
 */
export function carePayload(args: {
  locale: string;
  person: { id: string; name: string; timezone: string };
  forOther: boolean;
  items: CareItem[];
  now: number;
  update?: boolean;
}): PushPayload {
  const { t, locale } = translatorFor(args.locale);
  const items = [...args.items].sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
  const line = (i: CareItem) => {
    const time = i.dueAt !== null ? formatTime(i.dueAt, locale, args.person.timezone) : null;
    if (i.daysLeft < 0) return t("care.pushOverdue", { name: i.name, count: -i.daysLeft });
    if (i.daysLeft === 0) return time ? t("care.pushTodayAt", { name: i.name, time }) : t("care.pushToday", { name: i.name });
    if (i.daysLeft === 1 && time) return t("care.pushTomorrowAt", { name: i.name, time });
    return t("care.pushLeft", { name: i.name, count: i.daysLeft });
  };
  const tasks = items.filter((i) => i.itemKind !== "measure");
  return {
    kind: args.update ? "update" : undefined,
    title: args.forOther ? args.person.name : t("care.pushTitle"),
    body: items.map(line).join("\n"),
    tag: careTag(args.person.id),
    renotify: !args.update,
    silent: args.update || undefined,
    actions: tasks.length === items.length ? [{ action: "done", title: t("care.actionDone") }] : [],
    data: {
      url: `/?person=${encodeURIComponent(args.person.id)}`,
      personId: args.person.id,
      care: true,
      items: items.map((i) => ({
        medicineId: i.medicineId,
        slotAt: new Date(i.cycleAt).toISOString(),
        amount: 1,
        care: true,
        ...(i.itemKind === "measure" ? { measure: true } : {}),
      })),
    },
  };
}

function lowerFirst(s: string, locale: string) {
  return s.charAt(0).toLocaleLowerCase(locale) + s.slice(1);
}

export function testPayload(locale: string): PushPayload {
  const { t } = translatorFor(locale);
  return { title: t("app.name"), body: t("push.test"), tag: "pills-test" };
}
