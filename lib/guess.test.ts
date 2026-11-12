import { describe, expect, it } from "vitest";
import { clusterTimes, guessSchedule, type GuessInput } from "./guess";
import { addDays, zonedToUtc } from "./tz";

const TZ = "Europe/Oslo";
const now = zonedToUtc("2026-11-12", "12:00", TZ);

function daysOf(times: string[], days = 14) {
  const logs = [];
  for (let i = 1; i <= days; i++) {
    for (const t of times) {
      logs.push({ takenAt: zonedToUtc(addDays("2026-11-12", -i), t, TZ), status: "taken" as const });
    }
  }
  return logs;
}

const input = (p: Partial<GuessInput>): GuessInput => ({
  presets: [1],
  defaultPreset: null,
  maxPerIntake: null,
  maxPerDay: null,
  archived: false,
  logs: [],
  timezone: TZ,
  now,
  ...p,
});

describe("guessSchedule", () => {
  it("few logs → as needed, keeps the default preset as the dose", () => {
    expect(guessSchedule(input({ presets: [0.5, 1], defaultPreset: 1, logs: daysOf(["08:00"], 3) }))).toEqual({
      mode: "asNeeded",
      doseAmount: 1,
      times: null,
      reviewed: false,
    });
  });

  it("twice a day around 08 and 20 → fixed 08:00 + 20:00", () => {
    const logs = daysOf(["07:50", "20:20"]);
    const g = guessSchedule(input({ logs }));
    expect(g.mode).toBe("fixed");
    expect(g.times).toEqual(["08:00", "20:30"]);
  });

  it("n from max per day / max per intake", () => {
    const g = guessSchedule(input({ maxPerDay: 2, maxPerIntake: 1, logs: daysOf(["09:10", "21:05"]) }));
    expect(g.times).toEqual(["09:00", "21:00"]);
  });

  it("a painkiller used less than 0.7 × n a day → as needed", () => {
    const logs = daysOf(["10:00"]);
    expect(guessSchedule(input({ maxPerDay: 3, maxPerIntake: 1, logs })).mode).toBe("asNeeded");
  });

  it("n outside 1–4 → as needed", () => {
    expect(guessSchedule(input({ maxPerDay: 6, maxPerIntake: 1, logs: daysOf(["08:00"]) })).mode).toBe("asNeeded");
  });

  it("archived → as needed and already reviewed", () => {
    expect(guessSchedule(input({ archived: true, logs: daysOf(["08:00"]) }))).toMatchObject({ mode: "asNeeded", reviewed: true });
  });

  it("wide spread → default times for n", () => {
    const logs = [...daysOf(["06:00"], 7), ...daysOf(["11:00"], 14).slice(7)];
    expect(guessSchedule(input({ logs })).times).toEqual(["08:00"]);
  });

  it("skipped logs do not count", () => {
    const logs = daysOf(["08:00"]).map((l) => ({ ...l, status: "skipped" as const }));
    expect(guessSchedule(input({ logs })).mode).toBe("asNeeded");
  });
});

describe("clusterTimes", () => {
  it("keeps times around midnight together", () => {
    expect(clusterTimes([23 * 60 + 50, 10, 23 * 60 + 55, 5, 0], 1)).toEqual(["00:00"]);
  });
  it("three clusters", () => {
    expect(clusterTimes([420, 430, 900, 910, 1380, 1370], 3)).toEqual(["07:00", "15:00", "23:00"]);
  });
});
