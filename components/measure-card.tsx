"use client";

import { useLocale, useTranslations } from "next-intl";
import { Ellipsis, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDose, formatRelative } from "@/lib/format";
import type { LogEntry } from "@/lib/schedule";
import { colorClasses, type MedicineDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A measurement with no schedule ("any time"): the last reading and a Log button. */
export function MeasureCard({
  medicine,
  logs,
  lastAt,
  now,
  lastBy,
  highlight,
  onLog,
  onMore,
}: {
  medicine: MedicineDTO;
  logs: LogEntry[];
  /** The last reading's time when it is older than the loaded logs. */
  lastAt: number | null;
  now: number;
  lastBy: string | null;
  highlight?: boolean;
  onLog: () => void;
  onMore: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const colors = colorClasses[medicine.color] ?? colorClasses.blue;
  const last = logs.filter((l) => l.status !== "skipped").sort((a, b) => b.takenAt - a.takenAt)[0];
  return (
    <Card className={cn("gap-2 border-l-4 p-3.5 transition-shadow duration-700", colors.accent, highlight && "ring-2 ring-teal-500")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{medicine.name}</h3>
          <p className="text-sm text-muted-foreground">
            {last
              ? t("care.lastReading", {
                  value: formatDose(last.amount, medicine.unit, t),
                  time: formatRelative(last.takenAt, locale, now),
                })
              : lastAt !== null
                ? t("care.lastMeasuredAt", { time: formatRelative(lastAt, locale, now) })
                : t("care.noReadings")}
            {last && lastBy && <> · {t("people.loggedBy", { name: lastBy })}</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" className={cn("h-10", colors.bg)} onClick={onLog}>
            <Plus className="size-4" /> {t("home.take", { form: "measure" })}
          </Button>
          <Button variant="ghost" size="icon" aria-label={t("home.more")} onClick={onMore}>
            <Ellipsis className="size-5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
