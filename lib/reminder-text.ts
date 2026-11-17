import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import nb from "@/messages/nb.json";
import { formatDose, formatTime } from "@/lib/format";
import type { ReminderKind } from "@/lib/schedule";
import type { PushPayload } from "@/lib/push";

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
  const doseText = (list: ReminderItem[]) => list.map((i) => `${i.name}, ${formatDose(i.amount, i.unit, t)}`).join("; ");
  const verbOf = (list: ReminderItem[]) => (list.every((i) => i.form === "cream") ? "apply" : "take");
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
  const verb = verbOf(items);
  return {
    kind: args.update ? "update" : undefined,
    title,
    body,
    tag: reminderTag(args.person.id),
    renotify: !args.update,
    silent: args.update || undefined,
    actions: [
      { action: "taken", title: t("push.actionTaken", { verb }) },
      { action: "snooze", title: t("push.actionSnooze") },
    ],
    data: {
      url: `/?person=${encodeURIComponent(args.person.id)}`,
      personId: args.person.id,
      items: items.map((i) => ({
        medicineId: i.medicineId,
        slotAt: new Date(i.slotAt).toISOString(),
        amount: i.amount,
      })),
    },
  };
}

/** Everything for this person is answered: take its notification away. */
export function closePayload(locale: string, personId: string): PushPayload {
  const { t } = translatorFor(locale);
  return { kind: "close", title: t("app.name"), body: "", tag: reminderTag(personId), data: { personId } };
}

function lowerFirst(s: string, locale: string) {
  return s.charAt(0).toLocaleLowerCase(locale) + s.slice(1);
}

export function testPayload(locale: string): PushPayload {
  const { t } = translatorFor(locale);
  return { title: t("app.name"), body: t("push.test"), tag: "pills-test" };
}
