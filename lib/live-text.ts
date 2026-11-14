// Pure wording for "someone else logged a dose": the in-app overlay and the push
// notice use the same sentences, in the reader's language. Clock-free.
import { formatDose, formatList, formatWhen } from "./format";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export type LoggedStatus = "taken" | "uncertain" | "skipped";

export interface LoggedItem {
  doseId: string;
  medicineId: string;
  medicineName: string;
  /** Creams are "applied", not "given". */
  form: string;
  amount: number;
  unit: string;
  status: LoggedStatus;
  takenAt: number;
  slotAt: number | null;
}

/** One logger's doses for one person (a single log, or several within seconds). */
export interface LoggedBatch {
  by: { id: string; name: string };
  person: { id: string; name: string; selfOfUserId: string | null };
  items: LoggedItem[];
}

/**
 * Whose medicine it is, seen by the reader: the logger's own ("Anna took Ibux"),
 * the reader's own ("Anna gave you Ibux"), or someone else's ("Anna gave Rex …").
 */
export function relationOf(person: LoggedBatch["person"], byUserId: string, readerId: string) {
  if (person.selfOfUserId === byUserId) return "self" as const;
  if (person.selfOfUserId === readerId) return "you" as const;
  return "other" as const;
}

/** "Anna" from "Anna Berg", "anna" from "anna@example.com". */
export function shortName(name: string | null | undefined, email?: string | null) {
  const base = (name ?? "").trim() || (email ?? "").split("@")[0] || "?";
  return base.split(/\s+/)[0];
}

const KEYS = {
  taken: { self: "live.self", you: "live.you", other: "live.other" },
  uncertain: { self: "live.uncertainSelf", you: "live.uncertainYou", other: "live.uncertainOther" },
  skipped: { self: "live.skippedSelf", you: "live.skippedYou", other: "live.skippedOther" },
} as const;

const ORDER: LoggedStatus[] = ["taken", "uncertain", "skipped"];

/**
 * One sentence per status, medicines joined as a list:
 * "Anna gave Rex Apoquel and Omega-3", "Anna skipped Ibux for you".
 */
export function loggedLines(t: Translate, locale: string, batch: LoggedBatch, readerId: string): string[] {
  const rel = relationOf(batch.person, batch.by.id, readerId);
  const lines: string[] = [];
  for (const status of ORDER) {
    const items = batch.items.filter((i) => i.status === status);
    if (!items.length) continue;
    const names = [...new Set(items.map((i) => i.medicineName))];
    lines.push(
      t(KEYS[status][rel], {
        by: batch.by.name,
        person: batch.person.name,
        medicine: formatList(names, locale),
        form: items.every((i) => i.form === "cream") ? "cream" : "other",
      }),
    );
  }
  return lines;
}

/** "1 tablet · 14:05" (or "yesterday 20:00" for a backdated log). */
export function loggedDetail(t: Translate, locale: string, item: LoggedItem, now: number, timeZone: string) {
  const when = formatWhen(item.takenAt, now, locale, timeZone, t);
  return item.status === "skipped" ? when : `${formatDose(item.amount, item.unit, t)} · ${when}`;
}
