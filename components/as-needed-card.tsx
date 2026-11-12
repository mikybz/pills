"use client";

import { useLocale, useTranslations } from "next-intl";
import { Ellipsis } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { asNeededStatus } from "@/lib/safety";
import type { LogEntry } from "@/lib/schedule";
import { formatAmount, formatDose, formatRelative, formatTime } from "@/lib/format";
import { colorClasses, doseAmountOf, parsePresets, type MedicineDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Compact card: last intake, the limit line as facts, and quick-dose buttons. */
export function AsNeededCard({
  medicine,
  logs,
  now,
  timeZone,
  countUncertain,
  lastBy,
  onQuickLog,
  onMore,
}: {
  medicine: MedicineDTO;
  logs: LogEntry[];
  now: number;
  timeZone: string;
  countUncertain: boolean;
  lastBy: string | null;
  onQuickLog: (amount: number) => void;
  onMore: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const colors = colorClasses[medicine.color] ?? colorClasses.blue;
  const presets = parsePresets(medicine);
  const status = asNeededStatus(
    { maxPerIntake: medicine.maxPerIntake, maxPerDay: medicine.maxPerDay, minIntervalMin: medicine.minIntervalMin },
    logs,
    now,
    doseAmountOf(medicine),
    countUncertain,
  );
  const last = logs.filter((l) => l.status !== "skipped").sort((a, b) => b.takenAt - a.takenAt)[0];

  const facts: string[] = [];
  if (status.max) {
    facts.push(
      t("home.usedOf", {
        used: formatAmount(status.used),
        max: medicine.unit === "pcs" ? formatAmount(status.max) : `${formatAmount(status.max)} ${medicine.unit}`,
      }),
    );
  }
  if (status.nextFreeAt) facts.push(t("home.nextFreeAt", { time: formatTime(status.nextFreeAt, locale, timeZone) }));

  return (
    <Card className={cn("gap-2.5 border-l-4 p-3.5", colors.accent)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{medicine.name}</h3>
          <p className="text-sm text-muted-foreground">
            {last
              ? t("home.lastTaken", {
                  time: formatRelative(last.takenAt, locale, now),
                  dose: formatDose(last.amount, medicine.unit, t),
                })
              : t("home.neverTaken")}
            {lastBy && <> · {t("people.loggedBy", { name: lastBy })}</>}
            {last?.status === "uncertain" && (
              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs">{t("history.uncertain")}</span>
            )}
          </p>
          {facts.length > 0 && <p className="text-sm font-medium">{facts.join(" · ")}</p>}
        </div>
        <Button variant="ghost" size="icon" aria-label={t("home.more")} onClick={onMore}>
          <Ellipsis className="size-5" />
        </Button>
      </div>
      <div className="flex gap-2">
        {presets.map((p) => (
          <Button
            key={p}
            variant="outline"
            className={cn("h-11 flex-1 text-base font-semibold", colors.bg)}
            onClick={() => onQuickLog(p)}
          >
            {formatDose(p, medicine.unit, t)}
          </Button>
        ))}
      </div>
    </Card>
  );
}
