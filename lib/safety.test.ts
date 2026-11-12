import { describe, expect, it } from "vitest";
import { asNeededStatus, checkDose, LIMIT_WINDOW_MS, type Limits } from "./safety";
import { HOUR, MIN, type LogEntry, type Schedule } from "./schedule";
import { zonedToUtc } from "./tz";

const TZ = "Europe/Oslo";
const at = (date: string, time: string) => zonedToUtc(date, time, TZ);
const asNeeded: Schedule = {
  mode: "asNeeded",
  times: [],
  intervalH: null,
  startsOn: null,
  endsOn: null,
  minIntervalMin: null,
  timezone: TZ,
};
const dose = (takenAt: number, status: LogEntry["status"] = "taken", amount = 1): LogEntry => ({
  takenAt,
  slotAt: null,
  status,
  amount,
});
const check = (limits: Partial<Limits>, logs: LogEntry[], when: number, amount = 1, countUncertain = true) =>
  checkDose({
    schedule: asNeeded,
    limits: { maxPerIntake: null, maxPerDay: null, minIntervalMin: null, ...limits },
    logs,
    req: { amount, at: when, status: "taken", slotAt: null },
    countUncertain,
  });

describe("as needed", () => {
  it("the limit window is 24 h minus 4 h slack", () => {
    expect(LIMIT_WINDOW_MS).toBe(20 * HOUR);
  });

  it("9. max 3: doses at 08, 14, 20, then 06:00 the next day is fine; a fourth at 23:00 the same day warns", () => {
    const logs = [dose(at("2026-01-15", "08:00")), dose(at("2026-01-15", "14:00")), dose(at("2026-01-15", "20:00"))];
    expect(check({ maxPerDay: 3 }, logs, at("2026-01-16", "06:00")).level).toBe("ok");
    const r = check({ maxPerDay: 3 }, logs, at("2026-01-15", "23:00"));
    expect(r.level).toBe("warn");
    expect(r.reasons).toEqual([{ code: "overDaily", used: 3, amount: 1, max: 3, windowH: 20 }]);
  });

  it("a dose taken at 08:00 stops counting at 04:00 the next day", () => {
    const logs = [dose(at("2026-01-15", "08:00"), "taken", 3)];
    expect(check({ maxPerDay: 3 }, logs, at("2026-01-16", "03:59")).level).toBe("warn");
    expect(check({ maxPerDay: 3 }, logs, at("2026-01-16", "04:00")).level).toBe("ok");
  });

  it("warns above max per intake", () => {
    expect(check({ maxPerIntake: 1 }, [], 0, 1).level).toBe("ok");
    expect(check({ maxPerIntake: 1 }, [], 0, 1.5).reasons[0]).toEqual({ code: "overIntake", amount: 1.5, max: 1 });
  });

  it("warns when the last dose is less than the minimum interval ago", () => {
    const logs = [dose(at("2026-01-15", "08:00"))];
    expect(check({ minIntervalMin: 240 }, logs, at("2026-01-15", "11:59")).reasons[0].code).toBe("tooSoon");
    expect(check({ minIntervalMin: 240 }, logs, at("2026-01-15", "12:00")).level).toBe("ok");
  });

  it("there is no 'approaching the limit' warning", () => {
    const logs = [dose(at("2026-01-15", "08:00")), dose(at("2026-01-15", "14:00"))];
    expect(check({ maxPerDay: 3 }, logs, at("2026-01-15", "20:00")).level).toBe("ok");
  });

  it("uncertain counts by default; not when the setting is off; skipped never counts", () => {
    const logs = [dose(at("2026-01-15", "08:00"), "uncertain", 3)];
    expect(check({ maxPerDay: 3 }, logs, at("2026-01-15", "09:00")).level).toBe("warn");
    expect(check({ maxPerDay: 3 }, logs, at("2026-01-15", "09:00"), 1, false).level).toBe("ok");
    expect(check({ maxPerDay: 3 }, [dose(at("2026-01-15", "08:00"), "skipped", 3)], at("2026-01-15", "09:00")).level).toBe("ok");
  });

  it("a skip is never checked", () => {
    const r = checkDose({
      schedule: asNeeded,
      limits: { maxPerIntake: 1, maxPerDay: 1, minIntervalMin: 600 },
      logs: [dose(at("2026-01-15", "08:00"))],
      req: { amount: 5, at: at("2026-01-15", "08:01"), status: "skipped", slotAt: null },
      countUncertain: true,
    });
    expect(r.level).toBe("ok");
  });

  it("status line: used, and when the next dose is free", () => {
    const limits = { maxPerIntake: null, maxPerDay: 3, minIntervalMin: 240 };
    const logs = [dose(at("2026-01-15", "08:00")), dose(at("2026-01-15", "14:00")), dose(at("2026-01-15", "20:00"))];
    const s = asNeededStatus(limits, logs, at("2026-01-15", "21:00"), 1, true);
    expect(s.used).toBe(3);
    expect(s.max).toBe(3);
    expect(s.lastAt).toBe(at("2026-01-15", "20:00"));
    expect(s.nextFreeAt).toBe(at("2026-01-16", "04:00"));
    const s2 = asNeededStatus(limits, logs.slice(0, 1), at("2026-01-15", "09:00"), 1, true);
    expect(s2.nextFreeAt).toBe(at("2026-01-15", "12:00"));
    expect(asNeededStatus(limits, [], at("2026-01-15", "09:00"), 1, true).nextFreeAt).toBeNull();
  });
});

describe("scheduled", () => {
  const twice: Schedule = { ...asNeeded, mode: "fixed", times: ["08:00", "20:00"] };
  const slot = at("2026-01-15", "08:00");
  const run = (logs: LogEntry[], when: number, slotAt: number | null, s = twice) =>
    checkDose({
      schedule: s,
      limits: { maxPerIntake: 1, maxPerDay: 1, minIntervalMin: null },
      logs,
      req: { amount: 1, at: when, status: "taken", slotAt },
      countUncertain: false,
    });

  it("ignores daily max and per-intake limits", () => {
    expect(run([dose(at("2026-01-14", "20:00"))], slot, slot).level).toBe("ok");
  });

  it("warns when the previous dose is less than minGap (half the gap) ago", () => {
    const evening = at("2026-01-15", "20:00");
    const logs = [{ ...dose(slot), slotAt: slot }];
    expect(run(logs, at("2026-01-15", "13:59"), evening).reasons[0]).toMatchObject({ code: "tooSoon", minGapMin: 360 });
    expect(run(logs, at("2026-01-15", "14:00"), evening).level).toBe("ok");
  });

  it("an uncertain log in the slot warns even with countUncertain off", () => {
    const logs = [{ ...dose(slot, "uncertain"), slotAt: slot }];
    expect(run(logs, slot + 30 * MIN, slot).reasons).toEqual([{ code: "slotLogged", takenAt: slot }]);
  });

  it("a doctor's minimum gap overrides half the gap", () => {
    const s = { ...twice, minIntervalMin: 600 };
    const logs = [{ ...dose(slot), slotAt: slot }];
    expect(run(logs, at("2026-01-15", "17:00"), at("2026-01-15", "20:00"), s).level).toBe("warn");
  });
});
