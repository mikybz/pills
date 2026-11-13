import { describe, expect, it } from "vitest";
import { nightCandidates, scheduleOf, versionScheduleOf, type MedicineDTO } from "./types";

const person = { timezone: "Europe/Oslo", wakeTime: "07:00", bedTime: "23:00" };
const now = Date.parse("2026-01-15T12:00:00Z");

const med = (p: Partial<MedicineDTO>): MedicineDTO =>
  ({
    id: p.id ?? "m",
    name: "Med",
    mode: "fixed",
    times: JSON.stringify(["08:00", "20:00"]),
    intervalH: null,
    startsOn: null,
    endsOn: null,
    minIntervalMin: null,
    aroundTheClock: false,
    driftEnabled: true,
    archivedAt: null,
    hidden: false,
    scheduleReviewedAt: "2026-01-01T00:00:00Z",
    ...p,
  }) as MedicineDTO;

describe("scheduleOf", () => {
  it("uses the person's day window unless the medicine is taken around the clock", () => {
    expect(scheduleOf(med({}), person).day).toEqual({ wake: "07:00", bed: "23:00" });
    expect(scheduleOf(med({ aroundTheClock: true }), person).day).toBeNull();
    expect(scheduleOf(med({ driftEnabled: false }), person).drift).toBe(false);
  });

  it("stored versions have no window and no drift", () => {
    const v = versionScheduleOf({
      mode: "fixed",
      doseAmount: 1,
      times: '["08:00"]',
      intervalH: null,
      startsOn: null,
      endsOn: null,
      minIntervalMin: null,
      timezone: "Europe/Oslo",
      validFrom: "2026-01-01T00:00:00Z",
      validTo: "2026-01-02T00:00:00Z",
    });
    expect(v.day).toBeNull();
    expect(v.drift).toBe(false);
  });
});

describe("nightCandidates", () => {
  it("lists active, reviewed fixed medicines with a time in the sleep window, with the proposal", () => {
    const list = [
      med({ id: "night", times: JSON.stringify(["18:00", "06:00"]) }),
      med({ id: "day" }),
      med({ id: "allDay", times: JSON.stringify(["00:00"]), aroundTheClock: true }),
      med({ id: "archived", times: JSON.stringify(["00:00"]), archivedAt: "2026-01-10T00:00:00Z" }),
      med({ id: "unreviewed", times: JSON.stringify(["00:00"]), scheduleReviewedAt: null }),
      med({ id: "finished", times: JSON.stringify(["00:00"]), endsOn: "2026-01-14" }),
      med({ id: "interval", mode: "interval", times: null, intervalH: 8 }),
    ];
    expect(nightCandidates(list, person, now)).toEqual([
      { medicine: list[0], from: ["06:00", "18:00"], to: ["07:00", "19:00"] },
    ]);
  });
});
