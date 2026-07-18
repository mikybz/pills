/**
 * Pure dosage-safety model. No I/O — used identically on server and client.
 *
 * Linear budget model: with a max of `maxPerDay` per rolling 24 h spread over a
 * waking window of `wakeWindowH` hours, a dose of amount `a` "occupies"
 * (a / maxPerDay) * wakeWindowH hours, reduced by a slack factor so slightly
 * early re-dosing (or smaller doses more often) stays green.
 * Example: 1 mg max/intake, 3 mg max/day, 12 h wake window, 15 % slack
 * → required gap for 1 mg ≈ 3.4 h; 0.5 mg ≈ 1.7 h.
 */

export type DoseStatus = "taken" | "uncertain" | "skipped";
export type SafetyLevel = "green" | "yellow" | "red";

export interface DoseEntry {
  amount: number;
  takenAt: Date;
  status: DoseStatus;
}

export interface SafetyConfig {
  maxPerIntake?: number | null;
  maxPerDay?: number | null;
  /** Doctor-given minimum interval in minutes; overrides the linear model when stricter. */
  minIntervalMin?: number | null;
  /** Slack fraction 0–0.3. Higher = more lenient. Default 0.15. */
  slack?: number;
  /** Hours per day the daily budget is spread over. Default 12. */
  wakeWindowH?: number;
  /** Whether "uncertain" doses count toward totals. Default true (safest). */
  countUncertain?: boolean;
}

export interface SafetyResult {
  level: SafetyLevel;
  /** i18n message keys with params, most severe first. */
  reasons: { key: string; params?: Record<string, string | number> }[];
  /** Earliest time the reference dose would be green, if not green now. */
  nextOkAt: Date | null;
  used24: number;
  recentLoad: number;
}

const HOUR = 3_600_000;
const EPS = 1e-9;
const HARD_INTAKE_FACTOR = 1.1; // >110 % of max per intake is red
const DAILY_WARN_FRACTION = 0.85; // ≥85 % of daily max after dose is yellow

function defaults(cfg: SafetyConfig) {
  return {
    slack: cfg.slack ?? 0.15,
    wakeWindowH: cfg.wakeWindowH ?? 12,
    countUncertain: cfg.countUncertain ?? true,
  };
}

function countableDoses(doses: DoseEntry[], at: Date, countUncertain: boolean) {
  return doses.filter(
    (d) =>
      d.status !== "skipped" &&
      (countUncertain || d.status !== "uncertain") &&
      d.takenAt.getTime() <= at.getTime() + EPS,
  );
}

/** Milliseconds a dose of `amount` should occupy before the next full re-dose. */
export function requiredGapMs(amount: number, cfg: SafetyConfig): number | null {
  if (!cfg.maxPerDay || cfg.maxPerDay <= 0) return null;
  const { slack, wakeWindowH } = defaults(cfg);
  return (amount / cfg.maxPerDay) * wakeWindowH * HOUR * (1 - slack);
}

export function evaluateDose(
  cfg: SafetyConfig,
  doses: DoseEntry[],
  amount: number,
  at: Date = new Date(),
): SafetyResult {
  const { countUncertain } = defaults(cfg);
  const past = countableDoses(doses, at, countUncertain);

  const used24 = past
    .filter((d) => at.getTime() - d.takenAt.getTime() < 24 * HOUR)
    .reduce((s, d) => s + d.amount, 0);

  // How much of previous doses is still "active" under the linear release model.
  let recentLoad = 0;
  for (const d of past) {
    const gap = requiredGapMs(d.amount, cfg);
    if (!gap || gap <= 0) continue;
    const elapsed = at.getTime() - d.takenAt.getTime();
    if (elapsed < gap) recentLoad += d.amount * (1 - elapsed / gap);
  }

  const lastTaken = past.reduce<Date | null>(
    (m, d) => (!m || d.takenAt > m ? d.takenAt : m),
    null,
  );
  const sinceLastMs = lastTaken ? at.getTime() - lastTaken.getTime() : Infinity;

  const reasons: SafetyResult["reasons"] = [];
  let level: SafetyLevel = "green";
  const bump = (l: SafetyLevel) => {
    if (l === "red" || (l === "yellow" && level === "green")) level = l;
  };

  if (cfg.maxPerIntake && amount > cfg.maxPerIntake * HARD_INTAKE_FACTOR + EPS) {
    bump("red");
    reasons.push({
      key: "safety.overIntakeHard",
      params: { amount, max: cfg.maxPerIntake },
    });
  } else if (cfg.maxPerIntake && amount > cfg.maxPerIntake + EPS) {
    bump("yellow");
    reasons.push({
      key: "safety.overIntakeSoft",
      params: { amount, max: cfg.maxPerIntake },
    });
  }

  if (cfg.maxPerDay) {
    if (used24 + amount > cfg.maxPerDay + EPS) {
      bump("red");
      reasons.push({
        key: "safety.overDaily",
        params: { used: used24, max: cfg.maxPerDay },
      });
    } else if (used24 + amount > cfg.maxPerDay * DAILY_WARN_FRACTION + EPS) {
      bump("yellow");
      reasons.push({
        key: "safety.nearDaily",
        params: { used: used24, max: cfg.maxPerDay },
      });
    }
  }

  if (cfg.minIntervalMin && sinceLastMs < cfg.minIntervalMin * 60_000) {
    if (sinceLastMs < cfg.minIntervalMin * 60_000 * 0.9) {
      bump("red");
      reasons.push({
        key: "safety.tooSoonHard",
        params: { minutes: cfg.minIntervalMin },
      });
    } else {
      bump("yellow");
      reasons.push({
        key: "safety.tooSoonSoft",
        params: { minutes: cfg.minIntervalMin },
      });
    }
  }

  // Linear spacing check: taking `amount` now while previous doses are still
  // active would exceed one full intake's worth of "active" medicine.
  const spacingCap = cfg.maxPerIntake ?? cfg.maxPerDay ?? null;
  if (cfg.maxPerDay && spacingCap && recentLoad + amount > spacingCap + EPS) {
    bump("yellow");
    reasons.push({
      key: "safety.tooSoonLinear",
      params: { load: Math.round(recentLoad * 100) / 100 },
    });
  }

  const nextOkAt =
    level === "green" ? null : findNextOk(cfg, doses, amount, at);

  return { level, reasons, nextOkAt, used24, recentLoad };
}

/** Earliest time (5-min resolution, within 48 h) the dose becomes green. */
export function findNextOk(
  cfg: SafetyConfig,
  doses: DoseEntry[],
  amount: number,
  from: Date,
): Date | null {
  // A dose over the hard per-intake cap never becomes green.
  if (cfg.maxPerIntake && amount > cfg.maxPerIntake * HARD_INTAKE_FACTOR + EPS) {
    return null;
  }
  const STEP = 5 * 60_000;
  for (let t = STEP; t <= 48 * HOUR; t += STEP) {
    const when = new Date(from.getTime() + t);
    if (levelAt(cfg, doses, amount, when) === "green") return when;
  }
  return null;
}

// Level-only variant used by findNextOk's forward search (no nextOkAt recursion).
function levelAt(
  cfg: SafetyConfig,
  doses: DoseEntry[],
  amount: number,
  at: Date,
): SafetyLevel {
  const { countUncertain } = defaults(cfg);
  const past = countableDoses(doses, at, countUncertain);
  const used24 = past
    .filter((d) => at.getTime() - d.takenAt.getTime() < 24 * HOUR)
    .reduce((s, d) => s + d.amount, 0);
  let recentLoad = 0;
  for (const d of past) {
    const gap = requiredGapMs(d.amount, cfg);
    if (!gap || gap <= 0) continue;
    const elapsed = at.getTime() - d.takenAt.getTime();
    if (elapsed < gap) recentLoad += d.amount * (1 - elapsed / gap);
  }
  const lastTaken = past.reduce<Date | null>(
    (m, d) => (!m || d.takenAt > m ? d.takenAt : m),
    null,
  );
  const sinceLastMs = lastTaken ? at.getTime() - lastTaken.getTime() : Infinity;

  if (cfg.maxPerIntake && amount > cfg.maxPerIntake * HARD_INTAKE_FACTOR + EPS) return "red";
  if (cfg.maxPerDay && used24 + amount > cfg.maxPerDay + EPS) return "red";
  if (cfg.minIntervalMin && sinceLastMs < cfg.minIntervalMin * 60_000 * 0.9) return "red";

  if (cfg.maxPerIntake && amount > cfg.maxPerIntake + EPS) return "yellow";
  if (cfg.maxPerDay && used24 + amount > cfg.maxPerDay * DAILY_WARN_FRACTION + EPS) return "yellow";
  if (cfg.minIntervalMin && sinceLastMs < cfg.minIntervalMin * 60_000) return "yellow";
  const spacingCap = cfg.maxPerIntake ?? cfg.maxPerDay ?? null;
  if (cfg.maxPerDay && spacingCap && recentLoad + amount > spacingCap + EPS) return "yellow";
  return "green";
}
