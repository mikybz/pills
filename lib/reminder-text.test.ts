import { describe, expect, it } from "vitest";
import { closePayload, reminderPayload, reminderTag, translatorFor, type ReminderItem } from "./reminder-text";
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
    expect(closePayload("nb", "p")).toMatchObject({ kind: "close", tag: reminderTag("p"), body: "" });
  });
});
