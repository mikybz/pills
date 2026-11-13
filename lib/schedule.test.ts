import { describe, expect, it } from "vitest";
import {
  assignSlot,
  fitTimes,
  fixedSlots,
  historySlots,
  inSleep,
  intervalNextDue,
  intervalSlot,
  reminderEvents,
  slotForLog,
  spreadTimes,
  validDayWindow,
  SNOOZE_SEQ_BASE,
  HOUR,
  MIN,
  type LogEntry,
  type Schedule,
} from "./schedule";
import { checkDose } from "./safety";
import { zonedToUtc } from "./tz";

const TZ = "Europe/Oslo";
const at = (date: string, time: string) => zonedToUtc(date, time, TZ);

const DAY_7_23 = { wake: "07:00", bed: "23:00" };
const sched = (p: Partial<Schedule>): Schedule => ({
  mode: "fixed",
  times: [],
  intervalH: null,
  startsOn: null,
  endsOn: null,
  minIntervalMin: null,
  timezone: TZ,
  day: DAY_7_23,
  drift: true,
  ...p,
});
const daily = sched({ times: ["08:00"] });
const twice = sched({ times: ["08:00", "20:00"] });
const every8 = sched({ mode: "interval", intervalH: 8 });

const log = (takenAt: number, slotAt: number | null, status: LogEntry["status"] = "taken"): LogEntry => ({
  takenAt,
  slotAt,
  status,
  amount: 1,
});

const state = (now: number) => ({ now, leadMin: 10, missedFrom: 0 });

/** Assign the slot server-style and run the dose check. */
function logDose(s: Schedule, logs: LogEntry[], when: number, now = when) {
  const slotAt = assignSlot(s, logs, when, now, { leadMin: 10, anchor: 0 });
  const check = checkDose({
    schedule: s,
    limits: { maxPerIntake: null, maxPerDay: null, minIntervalMin: null },
    logs,
    req: { amount: 1, at: when, status: "taken", slotAt },
    countUncertain: true,
  });
  return { slotAt, check };
}

function slotsOn(s: Schedule, logs: LogEntry[], date: string, now: number) {
  return fixedSlots(s, logs, at(date, "00:00"), at(date, "23:59"), state(now));
}

describe("required scenarios (PLAN.md §2.6)", () => {
  it("1. once daily 08:00: taking it at 08:00 warns neither on the first day nor after", () => {
    const d1 = logDose(daily, [], at("2026-01-15", "08:00"));
    expect(d1.slotAt).toBe(at("2026-01-15", "08:00"));
    expect(d1.check.level).toBe("ok");
    const logs = [log(at("2026-01-15", "08:00"), d1.slotAt)];
    const d2 = logDose(daily, logs, at("2026-01-16", "08:00"));
    expect(d2.slotAt).toBe(at("2026-01-16", "08:00"));
    expect(d2.check.level).toBe("ok");
  });

  it("2. once daily: taken 09:30 yesterday and 08:00 today gives no warning", () => {
    const logs = [log(at("2026-01-15", "09:30"), at("2026-01-15", "08:00"))];
    const r = logDose(daily, logs, at("2026-01-16", "08:00"));
    expect(r.slotAt).toBe(at("2026-01-16", "08:00"));
    expect(r.check.level).toBe("ok");
  });

  it("3. a backdated dose for yesterday evening does not change today's slots or warn", () => {
    const now = at("2026-01-16", "07:00");
    const morning = log(at("2026-01-15", "08:05"), at("2026-01-15", "08:00"));
    const before = slotsOn(twice, [morning], "2026-01-16", now);

    const r = logDose(twice, [morning], at("2026-01-15", "21:00"), now);
    expect(r.slotAt).toBe(at("2026-01-15", "20:00"));
    expect(r.check.level).toBe("ok");
    const after = slotsOn(twice, [morning, log(at("2026-01-15", "21:00"), r.slotAt)], "2026-01-16", now);
    expect(after).toEqual(before);
    expect(after.map((s) => s.state)).toEqual(["upcoming", "upcoming"]);

    // Once daily, logged for yesterday evening inside yesterday's window.
    const d = logDose(daily, [], at("2026-01-15", "19:00"), now);
    expect(d.slotAt).toBe(at("2026-01-15", "08:00"));
    expect(d.check.level).toBe("ok");
    const today = slotsOn(daily, [log(at("2026-01-15", "19:00"), d.slotAt)], "2026-01-16", now);
    expect(today).toHaveLength(1);
    expect(today[0].effectiveAt).toBe(at("2026-01-16", "08:00"));
    expect(today[0].log).toBeNull();
  });

  it("4. 08:00 + 20:00: taken at 10:00, the next slot drifts to 21:00 (stays 20:00 without drift)", () => {
    const logs = [log(at("2026-01-15", "10:00"), at("2026-01-15", "08:00"))];
    const [, evening] = slotsOn(twice, logs, "2026-01-15", at("2026-01-15", "10:05"));
    expect(evening.slotAt).toBe(at("2026-01-15", "20:00"));
    expect(evening.effectiveAt).toBe(at("2026-01-15", "21:00"));
    expect(evening.moved).toBe("late");
    const [, plain] = slotsOn({ ...twice, drift: false }, logs, "2026-01-15", at("2026-01-15", "10:05"));
    expect(plain.effectiveAt).toBe(at("2026-01-15", "20:00"));
    expect(plain.moved).toBeNull();
  });

  it("5. 08:00 + 20:00: the morning slot is overdue at 13:59 and missed at 14:00", () => {
    expect(slotsOn(twice, [], "2026-01-15", at("2026-01-15", "13:59"))[0].state).toBe("overdue");
    expect(slotsOn(twice, [], "2026-01-15", at("2026-01-15", "14:00"))[0].state).toBe("missed");
  });

  it("6. 08:00 + 20:00: a missed morning dose taken at 16:00 moves the next to 23:00 (22:00 without drift), then back on the clock", () => {
    const logs = [log(at("2026-01-15", "16:00"), at("2026-01-15", "08:00"))];
    const range = [at("2026-01-15", "00:00"), at("2026-01-16", "23:59")] as const;
    const slots = fixedSlots(twice, logs, ...range, state(at("2026-01-15", "16:01")));
    // Drift 4 h (8 h late) capped at bedtime 23:00; the push rule alone gives 22:00.
    expect(slots.map((s) => s.effectiveAt)).toEqual([
      at("2026-01-15", "08:00"),
      at("2026-01-15", "23:00"),
      at("2026-01-16", "08:00"),
      at("2026-01-16", "20:00"),
    ]);
    expect(slots[1].slotAt).toBe(at("2026-01-15", "20:00"));
    const plain = fixedSlots({ ...twice, drift: false }, logs, ...range, state(at("2026-01-15", "16:01")));
    expect(plain.map((s) => s.effectiveAt)).toEqual([
      at("2026-01-15", "08:00"),
      at("2026-01-15", "22:00"),
      at("2026-01-16", "08:00"),
      at("2026-01-16", "20:00"),
    ]);
  });

  it("7. a second tap on a slot that is already logged warns", () => {
    const first = logDose(twice, [], at("2026-01-15", "08:05"));
    const logs = [log(at("2026-01-15", "08:05"), first.slotAt)];
    // Tapping the same row again (slot given explicitly).
    const again = checkDose({
      schedule: twice,
      limits: { maxPerIntake: null, maxPerDay: null, minIntervalMin: null },
      logs,
      req: { amount: 1, at: at("2026-01-15", "08:45"), status: "taken", slotAt: first.slotAt },
      countUncertain: true,
    });
    expect(again.level).toBe("warn");
    expect(again.reasons).toEqual([{ code: "slotLogged", takenAt: at("2026-01-15", "08:05") }]);
    // A tap without a row goes to the next slot (taken early) and still warns.
    const tap = logDose(twice, logs, at("2026-01-15", "08:45"));
    expect(tap.slotAt).toBe(at("2026-01-15", "20:00"));
    expect(tap.check.level).toBe("warn");
    expect(tap.check.reasons[0].code).toBe("tooSoon");
  });

  it("8. interval 8 h: taken at 09:10 makes the next due 17:10; a skip advances from slotAt", () => {
    const logs = [log(at("2026-01-15", "09:10"), at("2026-01-15", "09:00"))];
    expect(intervalNextDue(every8, logs, 0)).toBe(at("2026-01-15", "17:10"));
    const skipped = [...logs, log(at("2026-01-15", "18:30"), at("2026-01-15", "17:10"), "skipped")];
    expect(intervalNextDue(every8, skipped, 0)).toBe(at("2026-01-16", "01:10"));
  });

  // 9 (as needed, rolling window with slack) lives in safety.test.ts.

  it("10. slots across both DST changes in Europe/Oslo", () => {
    const s = sched({ times: ["02:30", "08:00"] });
    // Spring forward 2026-03-29: 02:00 → 03:00. 02:30 does not exist → 03:00 CEST.
    const spring = fixedSlots(s, [], at("2026-03-29", "00:00"), at("2026-03-29", "23:59"), state(0));
    expect(spring.map((x) => new Date(x.slotAt).toISOString())).toEqual([
      "2026-03-29T01:00:00.000Z",
      "2026-03-29T06:00:00.000Z",
    ]);
    // Fall back 2026-10-25: 03:00 → 02:00. 02:30 occurs twice → one slot, the first.
    const fall = fixedSlots(s, [], at("2026-10-25", "00:00"), at("2026-10-25", "23:59"), state(0));
    expect(fall.map((x) => new Date(x.slotAt).toISOString())).toEqual([
      "2026-10-25T00:30:00.000Z",
      "2026-10-25T07:00:00.000Z",
    ]);
    // 08:00 stays 08:00 local on both sides of each change.
    const d = fixedSlots(daily, [], at("2026-03-28", "00:00"), at("2026-03-30", "23:59"), state(0));
    expect(d.map((x) => new Date(x.slotAt).toISOString())).toEqual([
      "2026-03-28T07:00:00.000Z",
      "2026-03-29T06:00:00.000Z",
      "2026-03-30T06:00:00.000Z",
    ]);
  });

  it("11. endsOn yesterday produces no slots today", () => {
    const s = sched({ times: ["08:00", "20:00"], endsOn: "2026-01-14" });
    expect(slotsOn(s, [], "2026-01-15", at("2026-01-15", "09:00"))).toEqual([]);
    expect(slotsOn(s, [], "2026-01-14", at("2026-01-15", "09:00"))).toHaveLength(2);
    const iv = { ...every8, endsOn: "2026-01-14" };
    expect(intervalNextDue(iv, [log(at("2026-01-14", "20:00"), null)], 0)).toBeNull();
  });

  describe("12. reminder events", () => {
    const settings = { leadMin: 10, nagEveryMin: 15, nagMaxMin: 120 };
    const base = { schedule: daily, anchor: 0, remindFrom: 0, settings, snoozes: [] as { slotAt: number; until: number; seq: number }[] };
    const slot = at("2026-01-15", "08:00");
    const day = { from: at("2026-01-15", "00:00"), to: at("2026-01-15", "23:59") };

    it("heads-up, due, then repeats every 15 min up to 2 h", () => {
      const ev = reminderEvents({ ...base, logs: [], ...day });
      expect(ev.map((e) => [e.kind, e.seq, (e.at - slot) / MIN])).toEqual([
        ["headsUp", 0, -10],
        ["due", 0, 0],
        ...Array.from({ length: 8 }, (_, i) => ["nag", i + 1, (i + 1) * 15]),
      ]);
    });

    it("none after a log of any status", () => {
      for (const status of ["taken", "uncertain", "skipped"] as const) {
        const logs = [log(at("2026-01-15", "08:20"), slot, status)];
        const ev = reminderEvents({ ...base, logs, from: at("2026-01-15", "08:21"), to: day.to });
        expect(ev).toEqual([]);
      }
    });

    it("none during a snooze, one when it ends", () => {
      const snoozes = [{ slotAt: slot, until: slot + 50 * MIN, seq: 1 }];
      const ev = reminderEvents({ ...base, logs: [], snoozes, from: slot + 20 * MIN, to: day.to });
      expect(ev.map((e) => (e.at - slot) / MIN)).toEqual([50, 60, 75, 90, 105, 120]);
      expect(ev[0]).toMatchObject({ kind: "nag", seq: SNOOZE_SEQ_BASE + 1 });
    });

    it("a pushed slot uses the effective time", () => {
      // Without drift: 08:00 missed, taken late at 16:00 → 20:00 slot pushed to 22:00.
      const logs = [log(at("2026-01-15", "16:00"), slot)];
      const ev = reminderEvents({ ...base, schedule: { ...twice, drift: false }, logs, from: at("2026-01-15", "16:00"), to: day.to });
      const due = ev.find((e) => e.kind === "due")!;
      expect(due.slotAt).toBe(at("2026-01-15", "20:00"));
      expect(due.at).toBe(at("2026-01-15", "22:00"));
      expect(ev.find((e) => e.kind === "headsUp")!.at).toBe(at("2026-01-15", "21:50"));
    });

    it("only events inside (from, to], none before review, none past the cutoff", () => {
      const ev = reminderEvents({ ...base, logs: [], from: slot, to: slot + 15 * MIN });
      expect(ev.map((e) => e.kind)).toEqual(["nag"]);
      expect(reminderEvents({ ...base, remindFrom: null, logs: [], ...day })).toEqual([]);
      // Repeats never run past the cutoff (here 08:00 + 20:00 with a 10 h doctor's gap: cutoff 10:00).
      const tight = { ...twice, minIntervalMin: 600 };
      const ev2 = reminderEvents({ ...base, schedule: tight, settings: { ...settings, nagMaxMin: 240 }, logs: [], from: slot, to: at("2026-01-15", "12:00") });
      expect(Math.max(...ev2.map((e) => e.at))).toBeLessThan(at("2026-01-15", "10:00"));
    });

    it("interval mode reminds for the next due dose", () => {
      const logs = [log(at("2026-01-15", "09:10"), null)];
      const ev = reminderEvents({ ...base, schedule: every8, logs, from: at("2026-01-15", "16:59"), to: at("2026-01-15", "17:10") });
      expect(ev.map((e) => [e.kind, e.at])).toEqual([
        ["headsUp", at("2026-01-15", "17:00")],
        ["due", at("2026-01-15", "17:10")],
      ]);
    });

    it("lead 0 and repeats 0 turn those off", () => {
      const ev = reminderEvents({ ...base, settings: { leadMin: 0, nagEveryMin: 0, nagMaxMin: 120 }, logs: [], ...day });
      expect(ev.map((e) => e.kind)).toEqual(["due"]);
    });
  });
});

describe("required scenarios: day window and drift (PLAN.md §2.6)", () => {
  const opts = { leadMin: 10, anchor: 0 };

  it("13. a row log backdated to before the slot's window answers the earlier slot (or none); today's slot stays open", () => {
    const now = at("2026-01-16", "09:00");
    const morning = log(at("2026-01-16", "08:00"), at("2026-01-16", "08:00"));
    const tonight = at("2026-01-16", "20:00");
    // From today's 20:00 row, the forgotten dose was taken yesterday at 21:00.
    const backdated = at("2026-01-15", "21:00");
    expect(slotForLog(twice, [morning], tonight, backdated, now, opts)).toBe(at("2026-01-15", "20:00"));
    const after = [morning, log(backdated, at("2026-01-15", "20:00"))];
    const evening = slotsOn(twice, after, "2026-01-16", now)[1];
    expect(evening.slotAt).toBe(tonight);
    expect(evening.log).toBeNull();

    // Once daily: yesterday 21:00 is inside today's 08:00 window, but on an earlier
    // day: it answers yesterday's open slot, or none when that one is taken.
    const today8 = at("2026-01-16", "08:00");
    expect(slotForLog(daily, [], today8, backdated, now, opts)).toBe(at("2026-01-15", "08:00"));
    const yesterdayTaken = [log(at("2026-01-15", "08:00"), at("2026-01-15", "08:00"))];
    expect(slotForLog(daily, yesterdayTaken, today8, backdated, now, opts)).toBeNull();

    // The row keeps its slot from its window start on, for taps, and for an early
    // dose on the same day when the earlier slot is already taken.
    expect(slotForLog(twice, [morning], tonight, at("2026-01-16", "14:00"), at("2026-01-16", "15:00"), opts)).toBe(tonight);
    expect(slotForLog(twice, [morning], tonight, now, now, opts)).toBe(tonight);
    expect(slotForLog(twice, [morning], tonight, at("2026-01-16", "08:45"), now, opts)).toBe(tonight);
    // A late dose from a missed row stays on that row.
    const missed8 = at("2026-01-16", "08:00");
    expect(slotForLog(twice, [], missed8, at("2026-01-16", "16:00"), at("2026-01-16", "16:30"), opts)).toBe(missed8);
    // No row: the plain assignment; a stale (unreal) row is ignored.
    expect(slotForLog(twice, [], undefined, backdated, now, opts)).toBe(at("2026-01-15", "20:00"));
    expect(slotForLog(twice, [], at("2026-01-16", "12:00"), backdated, now, opts)).toBe(at("2026-01-15", "20:00"));
  });

  it("14. spreadTimes for 1–6 doses: 07–23, a short window and a wrapping window", () => {
    const spread = (day: { wake: string; bed: string }) => [1, 2, 3, 4, 5, 6].map((n) => spreadTimes(n, day));
    expect(spread(DAY_7_23)).toEqual([
      ["08:00"],
      ["08:00", "20:00"],
      ["07:00", "15:00", "23:00"],
      ["07:00", "12:30", "17:30", "23:00"],
      ["07:00", "11:00", "15:00", "19:00", "23:00"],
      ["07:00", "10:00", "13:30", "16:30", "20:00", "23:00"],
    ]);
    expect(spread({ wake: "09:00", bed: "21:00" })).toEqual([
      ["10:00"],
      ["09:00", "21:00"],
      ["09:00", "15:00", "21:00"],
      ["09:00", "13:00", "17:00", "21:00"],
      ["09:00", "12:00", "15:00", "18:00", "21:00"],
      ["09:00", "11:30", "14:00", "16:00", "18:30", "21:00"],
    ]);
    expect(spread({ wake: "15:00", bed: "07:00" })).toEqual([
      ["16:00"],
      ["16:00", "04:00"],
      ["15:00", "23:00", "07:00"],
      ["15:00", "20:30", "01:30", "07:00"],
      ["15:00", "19:00", "23:00", "03:00", "07:00"],
      ["15:00", "18:00", "21:30", "00:30", "04:00", "07:00"],
    ]);
    // Rounding never leaves the window.
    expect(spreadTimes(4, { wake: "07:15", bed: "22:45" })).toEqual(["07:30", "12:30", "17:30", "22:30"]);
  });

  it("15. fitTimes: shift, single time, re-spread, nothing to do", () => {
    expect(fitTimes(["06:00", "18:00"], DAY_7_23)).toEqual(["07:00", "19:00"]);
    expect(fitTimes(["23:30"], DAY_7_23)).toEqual(["23:00"]);
    expect(fitTimes(["06:00", "12:00", "18:00", "00:00"], DAY_7_23)).toEqual(["07:00", "12:30", "17:30", "23:00"]);
    expect(fitTimes(["08:00", "20:00"], DAY_7_23)).toBeNull();
    expect(fitTimes(["02:00"], null)).toBeNull();
  });

  describe("16. late-dose drift", () => {
    const four = sched({ times: ["08:00", "13:00", "18:00", "23:00"] });
    const on = (s: Schedule, logs: LogEntry[], date = "2026-01-15") => slotsOn(s, logs, date, at(date, "23:59"));
    const eveningAfter = (time: string, s: Schedule = twice) =>
      on(s, [log(at("2026-01-15", time), at("2026-01-15", "08:00"))])[1].effectiveAt;

    it("starts at 1 h late and rounds down to half hours", () => {
      expect(eveningAfter("08:59")).toBe(at("2026-01-15", "20:00"));
      expect(eveningAfter("09:00")).toBe(at("2026-01-15", "20:30"));
      expect(eveningAfter("10:00")).toBe(at("2026-01-15", "21:00"));
      expect(eveningAfter("11:20")).toBe(at("2026-01-15", "21:30"));
    });

    it("cascades back to the clock (drift measured against the nominal time)", () => {
      const first = [log(at("2026-01-15", "10:00"), at("2026-01-15", "08:00"))];
      expect(on(four, first)[1].effectiveAt).toBe(at("2026-01-15", "14:00"));
      const second = [...first, log(at("2026-01-15", "14:00"), at("2026-01-15", "13:00"))];
      expect(on(four, second)[2].effectiveAt).toBe(at("2026-01-15", "18:30"));
      const third = [...second, log(at("2026-01-15", "18:30"), at("2026-01-15", "18:00"))];
      expect(on(four, third)[3].effectiveAt).toBe(at("2026-01-15", "23:00"));
      expect(on(four, third)[3].moved).toBeNull();
    });

    it("is capped at bedtime; a bedtime dose never moves", () => {
      expect(eveningAfter("14:00")).toBe(at("2026-01-15", "23:00"));
      const late = [log(at("2026-01-15", "22:00"), at("2026-01-15", "18:00"))];
      // 18:00 taken 4 h late: drift 2 h capped at 23:00 → no drift, push rule floor 22:00 + 2.5 h.
      expect(on(four, late)[3].effectiveAt).toBe(at("2026-01-16", "00:30"));
      expect(on({ ...four, minIntervalMin: 30 }, late)[3].effectiveAt).toBe(at("2026-01-15", "23:00"));
    });

    it("never crosses the night", () => {
      // Evening dose 3 h late: the next morning stays 08:00 (a wake time lies between).
      const logs = [log(at("2026-01-15", "23:00"), at("2026-01-15", "20:00"))];
      expect(slotsOn(twice, logs, "2026-01-16", at("2026-01-16", "06:00"))[0].effectiveAt).toBe(at("2026-01-16", "08:00"));
      // A slot whose nominal time is in the sleep window does not drift.
      const night = sched({ times: ["08:00", "16:00", "00:00"] });
      const late = [log(at("2026-01-15", "19:00"), at("2026-01-15", "16:00"))];
      const slots = fixedSlots(night, late, at("2026-01-15", "12:00"), at("2026-01-16", "01:00"), state(at("2026-01-15", "19:01")));
      expect(slots.find((s) => s.slotAt === at("2026-01-16", "00:00"))!.effectiveAt).toBe(at("2026-01-16", "00:00"));
    });

    it("none after a skip, none when disabled", () => {
      const skipped = [log(at("2026-01-15", "10:00"), at("2026-01-15", "08:00"), "skipped")];
      expect(on(twice, skipped)[1].effectiveAt).toBe(at("2026-01-15", "20:00"));
      expect(eveningAfter("10:00", { ...twice, drift: false })).toBe(at("2026-01-15", "20:00"));
    });

    it("uncertain doses drift like taken ones", () => {
      const unsure = [log(at("2026-01-15", "10:00"), at("2026-01-15", "08:00"), "uncertain")];
      expect(on(twice, unsure)[1].effectiveAt).toBe(at("2026-01-15", "21:00"));
    });

    it("around the clock: no bedtime clamp", () => {
      const allDay = { ...twice, day: null };
      const logs = [log(at("2026-01-15", "16:00"), at("2026-01-15", "08:00"))];
      const slots = fixedSlots(allDay, logs, at("2026-01-15", "00:00"), at("2026-01-15", "23:59"), state(at("2026-01-15", "16:01")));
      expect(slots[1].effectiveAt).toBe(at("2026-01-16", "00:00"));
    });
  });

  it("17. interval: a due time in the sleep window is effective at the next wake time", () => {
    const logs = [log(at("2026-01-15", "17:10"), at("2026-01-15", "17:00"))];
    const now = at("2026-01-16", "02:00");
    const slot = intervalSlot(every8, logs, 0, { now, leadMin: 10, missedFrom: null })!;
    expect(slot.slotAt).toBe(at("2026-01-16", "01:10"));
    expect(slot.effectiveAt).toBe(at("2026-01-16", "07:00"));
    expect(slot.moved).toBe("night");
    expect(slot.state).toBe("upcoming");
    const allDay = intervalSlot({ ...every8, day: null }, logs, 0, { now, leadMin: 10, missedFrom: null })!;
    expect(allDay.effectiveAt).toBe(at("2026-01-16", "01:10"));
    expect(allDay.state).toBe("overdue");
  });

  it("18. reminder events use the drifted effective time", () => {
    const logs = [log(at("2026-01-15", "10:00"), at("2026-01-15", "08:00"))];
    const ev = reminderEvents({
      schedule: twice,
      logs,
      anchor: 0,
      remindFrom: 0,
      settings: { leadMin: 10, nagEveryMin: 0, nagMaxMin: 0 },
      snoozes: [],
      from: at("2026-01-15", "10:00"),
      to: at("2026-01-15", "23:59"),
    });
    expect(ev.map((e) => [e.kind, e.slotAt, e.at])).toEqual([
      ["headsUp", at("2026-01-15", "20:00"), at("2026-01-15", "20:50")],
      ["due", at("2026-01-15", "20:00"), at("2026-01-15", "21:00")],
    ]);
  });

  it("19. inSleep at both window edges and for a wrapping window", () => {
    expect(inSleep("07:00", DAY_7_23)).toBe(false);
    expect(inSleep("23:00", DAY_7_23)).toBe(false);
    expect(inSleep("06:59", DAY_7_23)).toBe(true);
    expect(inSleep("23:01", DAY_7_23)).toBe(true);
    expect(inSleep("03:00", DAY_7_23)).toBe(true);
    const wrap = { wake: "15:00", bed: "07:00" };
    expect(inSleep("15:00", wrap)).toBe(false);
    expect(inSleep("07:00", wrap)).toBe(false);
    expect(inSleep("02:00", wrap)).toBe(false);
    expect(inSleep("07:01", wrap)).toBe(true);
    expect(inSleep("14:59", wrap)).toBe(true);
    expect(inSleep("12:00", null)).toBe(false);
  });

  it("day windows must be 6–23 h awake", () => {
    expect(validDayWindow(DAY_7_23)).toBe(true);
    expect(validDayWindow({ wake: "15:00", bed: "07:00" })).toBe(true);
    expect(validDayWindow({ wake: "07:00", bed: "12:59" })).toBe(false);
    expect(validDayWindow({ wake: "07:00", bed: "06:30" })).toBe(false);
    expect(validDayWindow({ wake: "07:00", bed: "06:00" })).toBe(true);
    expect(validDayWindow({ wake: "07:00", bed: "07:00" })).toBe(false);
  });
});

describe("slot assignment", () => {
  it("a tap fills the oldest due or overdue slot", () => {
    // Yesterday's 20:00 is still overdue at 01:00 (cutoff 02:00); today's 08:00 is upcoming.
    expect(logDose(twice, [], at("2026-01-16", "01:00")).slotAt).toBe(at("2026-01-15", "20:00"));
  });

  it("a tap never fills a missed slot; it goes to the next slot", () => {
    expect(logDose(twice, [], at("2026-01-15", "15:00")).slotAt).toBe(at("2026-01-15", "20:00"));
  });

  it("a backdated time fills the slot whose window contains it", () => {
    const now = at("2026-01-15", "16:00");
    expect(logDose(twice, [], at("2026-01-15", "13:00"), now).slotAt).toBe(at("2026-01-15", "08:00"));
    expect(logDose(twice, [], at("2026-01-15", "15:00"), now).slotAt).toBe(at("2026-01-15", "20:00"));
  });

  it("once daily, 21:00 yesterday answers yesterday's open slot, not today's", () => {
    const now = at("2026-01-16", "09:00");
    const r = logDose(daily, [], at("2026-01-15", "21:00"), now);
    expect(r.slotAt).toBe(at("2026-01-15", "08:00"));
    // If yesterday was already taken, it is an extra dose with no slot.
    const taken = [log(at("2026-01-15", "08:00"), at("2026-01-15", "08:00"))];
    expect(logDose(daily, taken, at("2026-01-15", "21:00"), now).slotAt).toBeNull();
  });

  it("interval: first dose is due at the anchor; taking early answers that due time", () => {
    const anchor = at("2026-01-15", "09:00");
    const opts = { now: at("2026-01-15", "09:00"), leadMin: 10, missedFrom: null };
    expect(intervalSlot(every8, [], anchor, opts)?.state).toBe("overdue");
    expect(assignSlot(every8, [], anchor, anchor, { leadMin: 10, anchor })).toBe(anchor);
  });

  it("uncertain fills a slot", () => {
    const logs = [log(at("2026-01-15", "08:00"), at("2026-01-15", "08:00"), "uncertain")];
    expect(slotsOn(twice, logs, "2026-01-15", at("2026-01-15", "09:00"))[0].state).toBe("taken");
  });

  it("legacy logs (no slotAt) fill the slot whose window holds them", () => {
    const legacy: LogEntry = { ...log(at("2026-01-15", "08:05"), null), legacy: true };
    expect(slotsOn(twice, [legacy], "2026-01-15", at("2026-01-15", "09:00"))[0].state).toBe("taken");
    const notLegacy = log(at("2026-01-15", "08:05"), null);
    expect(slotsOn(twice, [notLegacy], "2026-01-15", at("2026-01-15", "09:00"))[0].state).toBe("overdue");
  });

  it("states: upcoming, due within the lead, overdue after", () => {
    const s = (t: string) => slotsOn(daily, [], "2026-01-15", at("2026-01-15", t))[0].state;
    expect(s("07:49")).toBe("upcoming");
    expect(s("07:50")).toBe("due");
    expect(s("08:00")).toBe("overdue");
    expect(s("19:59")).toBe("overdue");
    expect(s("20:00")).toBe("missed");
  });

  it("no missed slots before missedFrom (unreviewed / before review)", () => {
    const slots = fixedSlots(twice, [], at("2026-01-15", "00:00"), at("2026-01-15", "23:59"), {
      now: at("2026-01-15", "15:00"),
      leadMin: 10,
      missedFrom: null,
    });
    expect(slots[0].state).toBe("lapsed");
  });
});

describe("history", () => {
  it("missed slots follow the schedule that was in force, from review onward", () => {
    const old = { ...twice };
    const now = at("2026-01-17", "12:00");
    const changed = at("2026-01-16", "12:00");
    const segments = [
      { schedule: old, from: at("2026-01-15", "09:00"), to: changed },
      { schedule: { ...daily, times: ["09:00"] }, from: changed, to: Infinity },
    ];
    const logs = [log(at("2026-01-15", "20:10"), at("2026-01-15", "20:00"))];
    const h = historySlots(segments, logs, at("2026-01-14", "00:00"), now, now);
    expect(h.map((x) => [new Date(x.slotAt).toISOString(), x.state])).toEqual([
      // 08:00 on the 15th is before review: not derived.
      ["2026-01-15T19:00:00.000Z", "taken"],
      ["2026-01-16T07:00:00.000Z", "missed"],
      ["2026-01-17T08:00:00.000Z", "overdue"],
    ]);
  });

  it("interval slots come from the logs", () => {
    const logs = [log(at("2026-01-15", "09:10"), at("2026-01-15", "09:00")), log(at("2026-01-15", "18:00"), null)];
    const h = historySlots([{ schedule: every8, from: 0, to: Infinity }], logs, 0, at("2026-01-16", "00:00"), at("2026-01-16", "00:00"));
    expect(h).toHaveLength(1);
    expect(h[0].state).toBe("taken");
  });

  it("a range with no schedule in force has no slots", () => {
    expect(historySlots([], [], 0, 10 * HOUR, 10 * HOUR)).toEqual([]);
  });
});
