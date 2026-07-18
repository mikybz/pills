"use client";

import { useLocale, useTranslations } from "next-intl";
import { Ellipsis } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { colorClasses, parsePresets, type DoseDTO, type MedicineDTO } from "@/lib/types";
import { evaluateDose, type SafetyConfig, type SafetyLevel, type DoseStatus } from "@/lib/safety";
import { formatAmount, formatRelative, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const levelClasses: Record<SafetyLevel, string> = {
  green: "",
  yellow:
    "border-amber-400 bg-amber-400/15 text-amber-700 hover:bg-amber-400/25 dark:text-amber-300",
  red: "border-red-500 bg-red-500/15 text-red-700 hover:bg-red-500/25 dark:text-red-400",
};

export function MedicineCard({
  medicine,
  doses,
  safetyConfig,
  onQuickLog,
  onMore,
}: {
  medicine: MedicineDTO;
  /** This medicine's doses, newest first, covering at least 48 h. */
  doses: DoseDTO[];
  safetyConfig: SafetyConfig;
  onQuickLog: (amount: number) => void;
  onMore: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const colors = colorClasses[medicine.color] ?? colorClasses.blue;
  const presets = parsePresets(medicine);
  const now = new Date();

  const entries = doses.map((d) => ({
    amount: d.amount,
    takenAt: new Date(d.takenAt),
    status: d.status as DoseStatus,
  }));
  const counted = entries.filter((d) => d.status !== "skipped");
  const last = counted.length ? counted[0] : null;

  const refAmount = medicine.defaultPreset ?? presets[0];
  const refSafety = evaluateDose(safetyConfig, entries, refAmount, now);

  return (
    <Card className={cn("gap-3 border-l-4 p-4", colors.accent)}>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">{medicine.name}</h2>
          <p className="text-sm text-muted-foreground">
            {last
              ? t("home.lastTaken", {
                  time: formatRelative(last.takenAt, locale, now),
                  amount: formatAmount(last.amount),
                  unit: medicine.unit,
                })
              : t("home.neverTaken")}
            {last?.status === "uncertain" && (
              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs">
                {t("home.uncertainBadge")}
              </span>
            )}
          </p>
          <p
            className={cn(
              "mt-0.5 text-sm font-medium",
              refSafety.level === "green"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400",
            )}
          >
            {refSafety.level === "green"
              ? t("home.okNow")
              : refSafety.nextOkAt
                ? t("home.nextOkAt", {
                    time: formatTime(new Date(refSafety.nextOkAt), locale),
                  })
                : null}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("home.more")}
          onClick={onMore}
        >
          <Ellipsis className="size-5" />
        </Button>
      </div>

      <DayDots doses={entries} colorDot={colors.dot} now={now} />

      <div className="flex gap-2">
        {presets.map((p) => {
          const s = evaluateDose(safetyConfig, entries, p, now);
          return (
            <Button
              key={p}
              variant="outline"
              size="lg"
              className={cn(
                "h-12 flex-1 text-base font-semibold",
                s.level === "green" ? colors.bg : levelClasses[s.level],
              )}
              onClick={() => onQuickLog(p)}
            >
              {formatAmount(p)} {medicine.unit}
            </Button>
          );
        })}
      </div>
    </Card>
  );
}

/** Mini 24h strip: one dot per dose in the last 24 hours, positioned by time. */
function DayDots({
  doses,
  colorDot,
  now,
}: {
  doses: { amount: number; takenAt: Date; status: DoseStatus }[];
  colorDot: string;
  now: Date;
}) {
  const dayMs = 24 * 3_600_000;
  const recent = doses.filter(
    (d) => d.status !== "skipped" && now.getTime() - d.takenAt.getTime() < dayMs,
  );
  const maxAmount = Math.max(...recent.map((d) => d.amount), 1);
  return (
    <div className="relative h-3 rounded-full bg-muted" aria-hidden>
      {recent.map((d, i) => {
        const frac = 1 - (now.getTime() - d.takenAt.getTime()) / dayMs;
        const size = 6 + (d.amount / maxAmount) * 6;
        return (
          <span
            key={i}
            className={cn(
              "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
              colorDot,
              d.status === "uncertain" && "opacity-40",
            )}
            style={{ left: `${frac * 100}%`, width: size, height: size }}
          />
        );
      })}
    </div>
  );
}
