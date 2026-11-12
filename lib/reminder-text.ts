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
  slotAt: number;
}

/**
 * One notification for all of a person's slots at the same instant, in the
 * receiving user's language. The tag `personId:slotAt` makes a later reminder
 * replace the earlier one instead of stacking.
 */
export function reminderPayload(args: {
  locale: string;
  kind: ReminderKind;
  person: { id: string; name: string; timezone: string };
  /** Prefix the person's name (another person or a pet). */
  forOther: boolean;
  effectiveAt: number;
  leadMin: number;
  items: ReminderItem[];
}): PushPayload {
  const { t, locale } = translatorFor(args.locale);
  const doses = args.items.map((i) => `${i.name}, ${formatDose(i.amount, i.unit, t)}`).join("; ");
  const names = args.items.map((i) => i.name).join(", ");
  const time = formatTime(args.effectiveAt, locale, args.person.timezone);
  let text =
    args.kind === "headsUp"
      ? t("push.headsUp", { minutes: args.leadMin, doses })
      : args.kind === "due"
        ? t("push.due", { doses })
        : t("push.nag", { names, time });
  if (args.forOther) text = t("push.forOther", { name: args.person.name, text: lowerFirst(text, locale) });
  return {
    title: t("app.name"),
    body: text,
    tag: `${args.person.id}:${new Date(args.effectiveAt).toISOString()}`,
    renotify: true,
    actions: [
      { action: "taken", title: t("push.actionTaken") },
      { action: "snooze", title: t("push.actionSnooze") },
    ],
    data: {
      url: "/",
      personId: args.person.id,
      items: args.items.map((i) => ({
        medicineId: i.medicineId,
        slotAt: new Date(i.slotAt).toISOString(),
        amount: i.amount,
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
