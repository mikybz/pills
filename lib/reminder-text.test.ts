import { describe, expect, it } from "vitest";
import {
  carePayload,
  careTag,
  closePayload,
  reminderPayload,
  reminderTag,
  translatorFor,
  type CareItem,
  type ReminderItem,
} from "./reminder-text";
import { formatDose, unitLabel } from "./format";

const person = { id: "p", name: "Rex", timezone: "Europe/Oslo" };
const item = (p: Partial<ReminderItem>): ReminderItem => ({
  medicineId: "m",
  name: "Ibux",
  amount: 1,
  unit: "pcs",
  form: "pill",
  slotAt: 0,
  effectiveAt: 0,
  kind: "due",
  ...p,
});
const payload = (locale: string, kind: "due" | "nag", items: ReminderItem[]) =>
  reminderPayload({ locale, person, forOther: false, leadMin: 10, items: items.map((i) => ({ ...i, kind })) });

describe("cream", () => {
  it("counts applications in both languages", () => {
    const en = translatorFor("en").t;
    const nb = translatorFor("nb").t;
    expect(formatDose(1, "appl", en)).toBe("1 application");
    expect(formatDose(2, "appl", en)).toBe("2 applications");
    expect(formatDose(1, "appl", nb)).toBe("1 påsmøring");
    expect(formatDose(2, "appl", nb)).toBe("2 påsmøringer");
    expect(unitLabel("appl", en)).toBe("applications");
    expect(formatDose(2, "pcs", en)).toBe("2 tablets");
  });

  it("push texts say apply for creams, take otherwise", () => {
    const cream = item({ name: "Salve", unit: "appl", form: "cream" });
    expect(payload("en", "due", [cream]).body).toBe("Time to apply Salve, 1 application");
    expect(payload("en", "due", [cream]).actions?.[0].title).toBe("Applied");
    expect(payload("nb", "due", [cream]).body).toBe("Smør på Salve, 1 påsmøring");
    expect(payload("en", "nag", [cream]).body).toMatch(/^Still not applied: Salve/);
    expect(payload("en", "due", [item({})]).body).toBe("Time to take Ibux, 1 tablet");
    // Mixed group: the general verb.
    expect(payload("en", "due", [cream, item({})]).actions?.[0].title).toBe("Taken");
  });
});

describe("one notification per person", () => {
  const H = 3_600_000;
  const morning = item({ slotAt: 8 * H, effectiveAt: 8 * H, kind: "nag" });
  const noon = item({ name: "Vit D", slotAt: 12 * H, effectiveAt: 12 * H, kind: "due" });

  it("uses one tag per person so a new reminder replaces the last", () => {
    const p = reminderPayload({ locale: "en", person, forOther: false, leadMin: 10, items: [noon] });
    expect(p.tag).toBe(reminderTag("p"));
    expect(p.renotify).toBe(true);
    expect(p.kind).toBeUndefined();
  });

  it("lists one line per instant when several slots are open", () => {
    const p = reminderPayload({ locale: "en", person, forOther: false, leadMin: 10, items: [noon, morning] });
    expect(p.body).toBe("09:00 Ibux, 1 tablet\n13:00 Vit D, 1 tablet");
    expect((p.data as { items: unknown[] }).items).toHaveLength(2);
    // Another person: their name is the title instead of a prefix on every line.
    expect(reminderPayload({ locale: "en", person, forOther: true, leadMin: 10, items: [noon, morning] }).title).toBe("Rex");
  });

  it("keeps the sentence form for one instant, merging medicines", () => {
    const a = item({ kind: "due" });
    const b = item({ name: "Vit D", kind: "due" });
    expect(reminderPayload({ locale: "en", person, forOther: false, leadMin: 10, items: [a, b] }).body).toBe(
      "Time to take Ibux, 1 tablet; Vit D, 1 tablet",
    );
    expect(reminderPayload({ locale: "en", person, forOther: true, leadMin: 10, items: [a] }).body).toBe(
      "Rex: time to take Ibux, 1 tablet",
    );
  });

  it("an update replaces quietly; close carries the same tag and no text", () => {
    const u = reminderPayload({ locale: "en", person, forOther: false, leadMin: 10, items: [noon], update: true });
    expect(u).toMatchObject({ kind: "update", renotify: false, silent: true, tag: reminderTag("p") });
    expect(closePayload("nb", reminderTag("p"))).toMatchObject({ kind: "close", tag: reminderTag("p"), body: "" });
  });
});

describe("measurements in dose reminders", () => {
  it("say measure, list no amount, and offer no Taken (a reading needs a value)", () => {
    const bp = item({ name: "Blodtrykk", unit: "mmHg", itemKind: "measure" });
    const p = payload("en", "due", [bp]);
    expect(p.body).toBe("Time to measure: Blodtrykk");
    expect(p.actions?.map((a) => a.action)).toEqual(["snooze"]);
    expect(payload("nb", "nag", [bp]).body).toMatch(/^Ikke målt ennå: Blodtrykk/);
    // Mixed with a dose: Taken logs the dose only.
    const mixed = payload("en", "due", [bp, item({})]);
    expect(mixed.actions?.[0].action).toBe("taken");
    expect((mixed.data as { items: { measure?: boolean }[] }).items.filter((i) => i.measure)).toHaveLength(1);
  });
});

describe("care notification (tasks and to-dos)", () => {
  const bamse = { id: "b", name: "Bamse", timezone: "Europe/Oslo" };
  const care = (p: Partial<CareItem>): CareItem => ({
    medicineId: "c",
    name: "Klippe klør",
    itemKind: "task",
    state: "soon",
    daysLeft: 2,
    dueAt: null,
    cycleAt: 0,
    ...p,
  });
  const make = (locale: string, items: CareItem[], forOther = true) =>
    carePayload({ locale, person: bamse, forOther, items, now: 0 });

  it("one line per item, most urgent first, under the pet's name", () => {
    const p = make("en", [care({}), care({ medicineId: "w", name: "Wash", state: "overdue", daysLeft: -3 })]);
    expect(p.title).toBe("Bamse");
    expect(p.body).toBe("Wash: 3 days overdue\nKlippe klør: 2 days left");
    expect(p.tag).toBe(careTag("b"));
    expect(p.actions).toEqual([{ action: "done", title: "Done" }]);
    expect(make("nb", [care({ daysLeft: 1 })]).body).toBe("Klippe klør: 1 dag igjen");
    expect(make("nb", [care({ daysLeft: 0, state: "today" })], false).title).toBe("Gjøremål");
  });

  it("a one-off with a time names it; a measurement removes the Done action", () => {
    const vet = care({ name: "Vet", daysLeft: 0, state: "today", dueAt: Date.UTC(2026, 0, 20, 9, 30) });
    expect(make("en", [vet]).body).toBe("Vet: today at 10:30");
    expect(make("en", [care({ itemKind: "measure", name: "Weight", daysLeft: 0, state: "today" })]).actions).toEqual([]);
  });

  it("an update replaces quietly; the close targets the care tag", () => {
    const u = carePayload({ locale: "en", person: bamse, forOther: true, items: [care({})], now: 0, update: true });
    expect(u).toMatchObject({ kind: "update", renotify: false, silent: true });
    expect(closePayload("en", careTag("b"))).toMatchObject({ kind: "close", tag: "care:b" });
  });
});
