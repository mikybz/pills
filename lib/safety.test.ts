import { describe, expect, it } from "vitest";
import { evaluateDose, requiredGapMs, type DoseEntry, type SafetyConfig } from "./safety";

const cfg: SafetyConfig = { maxPerIntake: 1, maxPerDay: 3 }; // the example from the plan

const T0 = new Date("2026-01-01T08:00:00Z");
const h = (n: number) => new Date(T0.getTime() + n * 3_600_000);
const dose = (amount: number, at: Date, status: DoseEntry["status"] = "taken"): DoseEntry => ({
  amount,
  takenAt: at,
  status,
});

describe("requiredGapMs", () => {
  it("computes ~3.4h gap for 1mg with 3mg/day over 12h window and 15% slack", () => {
    expect(requiredGapMs(1, cfg)! / 3_600_000).toBeCloseTo(3.4, 1);
  });
  it("halves the gap for half the dose", () => {
    expect(requiredGapMs(0.5, cfg)! / 3_600_000).toBeCloseTo(1.7, 1);
  });
  it("returns null without a daily max", () => {
    expect(requiredGapMs(1, { maxPerIntake: 1 })).toBeNull();
  });
});

describe("evaluateDose", () => {
  it("is green with no history", () => {
    expect(evaluateDose(cfg, [], 1, T0).level).toBe("green");
  });

  it("is yellow when re-dosing 1mg too soon after 1mg", () => {
    const r = evaluateDose(cfg, [dose(1, T0)], 1, h(2));
    expect(r.level).toBe("yellow");
    expect(r.nextOkAt).not.toBeNull();
  });

  it("is green when re-dosing 1mg after the required gap (~3.5h)", () => {
    expect(evaluateDose(cfg, [dose(1, T0)], 1, h(3.5)).level).toBe("green");
  });

  it("allows 0.5mg sooner than 1mg", () => {
    expect(evaluateDose(cfg, [dose(1, T0)], 0.5, h(2)).level).toBe("green");
  });

  it("is red when exceeding the daily max in 24h", () => {
    const r = evaluateDose(cfg, [dose(1, T0), dose(1, h(4)), dose(1, h(8))], 1, h(12));
    expect(r.level).toBe("red");
    expect(r.reasons.some((x) => x.key === "safety.overDaily")).toBe(true);
  });

  it("warns while yesterday's doses are still inside the rolling 24h window", () => {
    const r = evaluateDose(cfg, [dose(1, T0), dose(1, h(4)), dose(1, h(8))], 1, h(25));
    expect(r.level).toBe("yellow");
  });

  it("frees up daily budget once doses fall out of the rolling 24h window", () => {
    const r = evaluateDose(cfg, [dose(1, T0), dose(1, h(4)), dose(1, h(8))], 1, h(33));
    expect(r.level).toBe("green");
  });

  it("is yellow slightly over max per intake, red far over", () => {
    expect(evaluateDose(cfg, [], 1.05, T0).level).toBe("yellow");
    expect(evaluateDose(cfg, [], 1.5, T0).level).toBe("red");
  });

  it("never returns a nextOkAt for a hard per-intake breach", () => {
    expect(evaluateDose(cfg, [], 1.5, T0).nextOkAt).toBeNull();
  });

  it("is yellow when approaching the daily max", () => {
    const r = evaluateDose(cfg, [dose(1, T0), dose(0.75, h(4))], 1, h(9));
    expect(r.level).toBe("yellow");
    expect(r.reasons.some((x) => x.key === "safety.nearDaily")).toBe(true);
  });

  it("respects an explicit minimum interval override", () => {
    const c = { ...cfg, minIntervalMin: 240 };
    expect(evaluateDose(c, [dose(0.5, T0)], 0.5, h(1)).level).toBe("red");
    expect(evaluateDose(c, [dose(0.5, T0)], 0.5, h(3.9)).level).toBe("yellow");
    expect(evaluateDose(c, [dose(0.5, T0)], 0.5, h(4.1)).level).toBe("green");
  });

  it("counts uncertain doses by default but not when disabled", () => {
    const doses = [dose(1, T0, "uncertain")];
    expect(evaluateDose(cfg, doses, 1, h(1)).level).toBe("yellow");
    expect(evaluateDose({ ...cfg, countUncertain: false }, doses, 1, h(1)).level).toBe("green");
  });

  it("ignores skipped doses", () => {
    expect(evaluateDose(cfg, [dose(1, T0, "skipped")], 1, h(0.5)).level).toBe("green");
  });

  it("nextOkAt lands where the dose actually becomes green", () => {
    const r = evaluateDose(cfg, [dose(1, T0)], 1, h(1));
    expect(r.nextOkAt).not.toBeNull();
    expect(evaluateDose(cfg, [dose(1, T0)], 1, r.nextOkAt!).level).toBe("green");
    const gapH = (r.nextOkAt!.getTime() - T0.getTime()) / 3_600_000;
    expect(gapH).toBeGreaterThan(3);
    expect(gapH).toBeLessThan(4);
  });

  it("works with no limits configured (always green)", () => {
    expect(evaluateDose({}, [dose(5, T0)], 5, h(0.1)).level).toBe("green");
  });
});
