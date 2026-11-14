import { describe, expect, it } from "vitest";
import { loggedDetail, loggedLines, relationOf, shortName, type LoggedBatch, type LoggedItem } from "./live-text";
import { translatorFor } from "./reminder-text";

const at = Date.UTC(2026, 10, 14, 13, 5); // 14:05 in Oslo
const item = (over: Partial<LoggedItem> = {}): LoggedItem => ({
  doseId: "d1",
  medicineId: "m1",
  medicineName: "Apoquel",
  form: "pill",
  amount: 1,
  unit: "pcs",
  status: "taken",
  takenAt: at,
  slotAt: at,
  ...over,
});

const anna = { id: "u-anna", name: "Anna" };
const rex = { id: "p-rex", name: "Rex", selfOfUserId: null };
const batch = (items: LoggedItem[], person: LoggedBatch["person"] = rex): LoggedBatch => ({ by: anna, person, items });

describe("relationOf", () => {
  it("tells the logger's own, the reader's own and someone else's person apart", () => {
    expect(relationOf({ ...rex, selfOfUserId: "u-anna" }, "u-anna", "u-me")).toBe("self");
    expect(relationOf({ ...rex, selfOfUserId: "u-me" }, "u-anna", "u-me")).toBe("you");
    expect(relationOf(rex, "u-anna", "u-me")).toBe("other");
  });
});

describe("loggedLines", () => {
  const en = translatorFor("en");
  const nb = translatorFor("nb");

  it("names the logger, the person and the medicine", () => {
    expect(loggedLines(en.t, "en", batch([item()]), "u-me")).toEqual(["Anna gave Rex Apoquel"]);
    expect(loggedLines(nb.t, "nb", batch([item()]), "u-me")).toEqual(["Anna ga Rex Apoquel"]);
  });

  it("speaks of the logger's own and the reader's own medicine", () => {
    const own = batch([item({ medicineName: "Ibux" })], { id: "p-a", name: "Anna B", selfOfUserId: "u-anna" });
    expect(loggedLines(en.t, "en", own, "u-me")).toEqual(["Anna took Ibux"]);
    const mine = batch([item({ medicineName: "Ibux" })], { id: "p-me", name: "Me", selfOfUserId: "u-me" });
    expect(loggedLines(en.t, "en", mine, "u-me")).toEqual(["Anna gave you Ibux"]);
    expect(loggedLines(nb.t, "nb", mine, "u-me")).toEqual(["Anna ga deg Ibux"]);
  });

  it("uses apply for creams", () => {
    expect(loggedLines(en.t, "en", batch([item({ medicineName: "Salve", form: "cream" })]), "u-me")).toEqual([
      "Anna applied Salve on Rex",
    ]);
  });

  it("joins several medicines and keeps one line per status", () => {
    const lines = loggedLines(
      en.t,
      "en",
      batch([
        item(),
        item({ doseId: "d2", medicineId: "m2", medicineName: "Omega-3" }),
        item({ doseId: "d3", medicineId: "m3", medicineName: "Drops", status: "skipped" }),
      ]),
      "u-me",
    );
    expect(lines).toEqual(["Anna gave Rex Apoquel and Omega-3", "Anna skipped Drops for Rex"]);
  });

  it("says when a dose was marked as not sure", () => {
    expect(loggedLines(en.t, "en", batch([item({ status: "uncertain" })]), "u-me")).toEqual([
      "Anna logged Apoquel for Rex, marked as not sure",
    ]);
  });
});

describe("loggedDetail", () => {
  const { t } = translatorFor("en");
  it("shows the dose and the time, and the day for a backdated log", () => {
    expect(loggedDetail(t, "en", item(), at + 60_000, "Europe/Oslo")).toBe("1 tablet · 14:05");
    expect(loggedDetail(t, "en", item(), at + 86_400_000, "Europe/Oslo")).toBe("1 tablet · yesterday 14:05");
    expect(loggedDetail(t, "en", item({ status: "skipped" }), at, "Europe/Oslo")).toBe("14:05");
  });
});

describe("shortName", () => {
  it("uses the first name, else the email's local part", () => {
    expect(shortName("Anna Berg", "a@x.no")).toBe("Anna");
    expect(shortName(null, "anna.berg@x.no")).toBe("anna.berg");
    expect(shortName("  ", null)).toBe("?");
  });
});
