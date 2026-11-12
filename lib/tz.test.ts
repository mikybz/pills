import { describe, expect, it } from "vitest";
import { addDays, daysBetween, localDate, localTime, weekdayMon0, zonedToUtc } from "./tz";

describe("tz", () => {
  it("wall clock → UTC in winter and summer", () => {
    expect(new Date(zonedToUtc("2026-01-15", "08:00", "Europe/Oslo")).toISOString()).toBe("2026-01-15T07:00:00.000Z");
    expect(new Date(zonedToUtc("2026-07-15", "08:00", "Europe/Oslo")).toISOString()).toBe("2026-07-15T06:00:00.000Z");
    expect(new Date(zonedToUtc("2026-07-15", "08:00", "America/New_York")).toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });

  it("nonexistent spring-forward time moves to the next valid minute", () => {
    const t = zonedToUtc("2026-03-29", "02:30", "Europe/Oslo");
    expect(localTime(t, "Europe/Oslo")).toBe("03:00");
  });

  it("repeated fall-back time resolves to the first occurrence", () => {
    const t = zonedToUtc("2026-10-25", "02:30", "Europe/Oslo");
    expect(new Date(t).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("local dates and calendar math", () => {
    expect(localDate(Date.UTC(2026, 0, 15, 23, 30), "Europe/Oslo")).toBe("2026-01-16");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(daysBetween("2026-01-01", "2026-03-01")).toBe(59);
    expect(weekdayMon0("2026-11-12")).toBe(3);
  });
});
