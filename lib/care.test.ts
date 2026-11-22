import { describe, expect, it } from "vitest";
import { careOpen, careReminderEvents, careStatus, lastLogAt, leadDays } from "./care";
import { checkDose } from "./safety";
import type { LogEntry, Schedule } from "./schedule";
import { zonedToUtc } from "./tz";

const TZ = "Europe/Oslo";
const at = (date: string, time: string) => zonedToUtc(date, time, TZ);
const care = (p: Partial<Schedule>): Schedule => ({
  mode: "flex",
  times: [],
  intervalH: null,
  startsOn: null,
  endsOn: null,
  minIntervalMin: null,
  timezone: TZ,
  day: null,
  drift: false,
  ...p,
});
const log = (takenAt: number, status: LogEntry["status"] = "taken"): LogEntry => ({ takenAt, slotAt: null, status, amount: 1 });
const wash = care({ maxDays: 14 });
const doneJan1 = at("2026-01-01", "10:00");

describe("flex: at the latest every N days", () => {
  it("lead time is ~20 % of the window, 1–7 days", () => {
    expect([1, 2, 7, 14, 21, 60].map(leadDays)).toEqual([1, 1, 1, 3, 4, 7]);
  });

  it("wash within 14 days: ok, then soon 3 days before, due on day 14, then overdue", () => {
    const s = (date: string) => careStatus(wash, doneJan1, 0, at(date, "12:00"))!;
    expect(s("2026-01-11")).toMatchObject({ state: "ok", dueDate: "2026-01-15", soonDate: "2026-01-12", daysLeft: 4 });
    expect(s("2026-01-12")).toMatchObject({ state: "soon", daysLeft: 3 });
    expect(s("2026-01-15")).toMatchObject({ state: "today", daysLeft: 0 });
    expect(s("2026-01-17")).toMatchObject({ state: "overdue", daysLeft: -2 });
  });

  it("a daily task done today is due tomorrow and not on Due now today", () => {
    const daily = care({ maxDays: 1 });
    const done = at("2026-01-15", "09:00");
    expect(careStatus(daily, done, 0, at("2026-01-15", "20:00"))!.state).toBe("ok");
    expect(careStatus(daily, done, 0, at("2026-01-16", "08:00"))!.state).toBe("today");
  });

  it("not more often than every 5 days: early until day 5", () => {
    const s = care({ maxDays: 14, minDays: 5 });
    expect(careStatus(s, doneJan1, 0, at("2026-01-05", "23:00"))!.state).toBe("early");
    expect(careStatus(s, doneJan1, 0, at("2026-01-06", "00:30"))!.state).toBe("ok");
  });

  it("the last stretch never starts before 'not more often than' allows it", () => {
    const s = care({ maxDays: 30, minDays: 28 });
    const st = careStatus(s, doneJan1, 0, at("2026-01-26", "12:00"))!;
    expect(st.soonDate).toBe("2026-01-29");
    expect(st.state).toBe("early");
    expect(careStatus(s, doneJan1, 0, at("2026-01-29", "12:00"))!.state).toBe("soon");
  });

  it("never done: due on the day it was set up (or startsOn)", () => {
    const anchor = at("2026-01-10", "18:00");
    expect(careStatus(wash, null, anchor, at("2026-01-10", "19:00"))).toMatchObject({ state: "today", dueDate: "2026-01-10" });
    expect(careStatus(wash, null, anchor, at("2026-01-12", "09:00"))!.state).toBe("overdue");
    const later = care({ maxDays: 14, startsOn: "2026-02-01" });
    expect(careStatus(later, null, anchor, at("2026-01-12", "09:00"))!.state).toBe("ok");
  });

  it("the last log of any status counts; the server's lastLogAt only when older than the loaded logs", () => {
    expect(lastLogAt([log(doneJan1), log(at("2026-01-03", "08:00"), "skipped")])).toBe(at("2026-01-03", "08:00"));
    expect(lastLogAt([], doneJan1, at("2026-01-05", "00:00"))).toBe(doneJan1);
    // The fallback is inside the loaded range but not in the logs: it was undone.
    expect(lastLogAt([], at("2026-01-06", "08:00"), at("2026-01-05", "00:00"))).toBe(null);
  });
});

describe("once: a dated to-do", () => {
  const vet = care({ mode: "once", dueOn: "2026-01-20", times: ["10:30"] });
  it("ok, soon the day before, today, overdue; any log finishes it", () => {
    const s = (date: string) => careStatus(vet, null, 0, at(date, "08:00"))!.state;
    expect([s("2026-01-18"), s("2026-01-19"), s("2026-01-20"), s("2026-01-21")]).toEqual(["ok", "soon", "today", "overdue"]);
    expect(careStatus(vet, at("2026-01-20", "11:00"), 0, at("2026-01-22", "08:00"))!.state).toBe("done");
    expect(careStatus(vet, null, 0, 0)!.dueAt).toBe(at("2026-01-20", "10:30"));
  });
});

describe("care reminders: one nudge a day at the care time", () => {
  it("from the first day of the last stretch until done", () => {
    const ev = careReminderEvents({ schedule: wash, lastAt: doneJan1, anchor: 0, remindTime: "17:00", from: at("2026-01-11", "00:00"), to: at("2026-01-16", "23:00") });
    expect(ev.map((e) => [e.at, e.seq])).toEqual(
      ["2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"].map((d, i) => [at(d, "17:00"), i]),
    );
    expect(new Set(ev.map((e) => e.cycleAt)).size).toBe(1);
  });

  it("nothing once it is done again (a new cycle that is not due)", () => {
    const ev = careReminderEvents({ schedule: wash, lastAt: at("2026-01-13", "09:00"), anchor: 0, remindTime: "17:00", from: at("2026-01-13", "10:00"), to: at("2026-01-16", "23:00") });
    expect(ev).toEqual([]);
  });

  it("a one-off with a time: the evening before, an hour before on the day, then daily", () => {
    const vet = care({ mode: "once", dueOn: "2026-01-20", times: ["10:30"] });
    const ev = careReminderEvents({ schedule: vet, lastAt: null, anchor: 0, remindTime: "17:00", from: at("2026-01-18", "00:00"), to: at("2026-01-21", "23:00") });
    expect(ev.map((e) => e.at)).toEqual([at("2026-01-19", "17:00"), at("2026-01-20", "09:30"), at("2026-01-21", "17:00")]);
  });

  it("open in the care notification only once its first nudge has gone out", () => {
    const open = (time: string) => careOpen({ schedule: wash, lastAt: doneJan1, anchor: 0, remindTime: "17:00", to: at("2026-01-12", time) });
    expect(open("16:59")).toBe(null);
    expect(open("17:00")?.state).toBe("soon");
  });
});

describe("care checks", () => {
  const check = (s: Schedule, logs: LogEntry[], when: number, lastTakenAt?: number) =>
    checkDose({
      schedule: s,
      limits: { maxPerIntake: null, maxPerDay: null, minIntervalMin: null },
      logs,
      req: { amount: 1, at: when, status: "taken", slotAt: null },
      countUncertain: true,
      lastTakenAt,
    });

  it("done again sooner than minDays warns; later is fine; a skip doesn't count", () => {
    const s = care({ maxDays: 14, minDays: 5 });
    expect(check(s, [log(doneJan1)], at("2026-01-04", "10:00")).reasons).toEqual([{ code: "careEarly", takenAt: doneJan1, minDays: 5 }]);
    expect(check(s, [log(doneJan1)], at("2026-01-06", "10:00")).level).toBe("ok");
    expect(check(s, [log(doneJan1, "skipped")], at("2026-01-04", "10:00")).level).toBe("ok");
    // The last time may be older than the loaded logs.
    expect(check(s, [], at("2026-01-04", "10:00"), doneJan1).level).toBe("warn");
  });

  it("no minDays: never warns", () => {
    expect(check(wash, [log(doneJan1)], at("2026-01-01", "11:00")).level).toBe("ok");
  });

  it("a one-off that is already done warns", () => {
    const vet = care({ mode: "once", dueOn: "2026-01-20" });
    expect(check(vet, [log(at("2026-01-20", "11:00"))], at("2026-01-20", "12:00")).reasons[0].code).toBe("careDone");
  });
});
