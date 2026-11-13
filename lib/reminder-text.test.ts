import { describe, expect, it } from "vitest";
import { reminderPayload, translatorFor, type ReminderItem } from "./reminder-text";
import { formatDose, unitLabel } from "./format";

const person = { id: "p", name: "Rex", timezone: "Europe/Oslo" };
const item = (p: Partial<ReminderItem>): ReminderItem => ({
  medicineId: "m",
  name: "Ibux",
  amount: 1,
  unit: "pcs",
  form: "pill",
  slotAt: 0,
  ...p,
});
const payload = (locale: string, kind: "due" | "nag", items: ReminderItem[]) =>
  reminderPayload({ locale, kind, person, forOther: false, effectiveAt: 0, leadMin: 10, items });

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
