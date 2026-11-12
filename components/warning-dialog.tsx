"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CheckResult, Reason } from "@/lib/safety";
import { formatAmount, formatDateTime, formatDose, formatDuration, formatTime } from "@/lib/format";
import { localDate } from "@/lib/tz";
import type { MedicineDTO } from "@/lib/types";
import { useNow } from "@/lib/use-now";

/**
 * The one confirm sheet before a likely double dose or an as-needed limit. It
 * states the facts and offers "Log anyway" / "Cancel". Logging is never blocked.
 */
export function WarningDialog({
  check,
  medicine,
  timeZone,
  onConfirm,
  onCancel,
}: {
  check: CheckResult;
  medicine: MedicineDTO;
  timeZone: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const now = useNow();

  const when = (at: number) =>
    localDate(at, timeZone) === localDate(now, timeZone)
      ? formatTime(at, locale, timeZone)
      : formatDateTime(at, locale, timeZone);

  function line(r: Reason) {
    switch (r.code) {
      case "slotLogged":
        return t("warning.slotLogged", { time: when(r.takenAt), ago: formatDuration(now - r.takenAt, t) });
      case "tooSoon":
        return t("warning.tooSoon", {
          time: when(r.takenAt),
          ago: formatDuration(now - r.takenAt, t),
          gap: formatDuration(r.minGapMin * 60_000, t),
        });
      case "overIntake":
        return t("warning.overIntake", {
          amount: formatDose(r.amount, medicine.unit, t),
          max: formatDose(r.max, medicine.unit, t),
        });
      case "overDaily":
        return t("warning.overDaily", {
          total: formatDose(r.used + r.amount, medicine.unit, t),
          hours: formatAmount(r.windowH),
          max: formatDose(r.max, medicine.unit, t),
        });
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-5" />
            {t("warning.title", { name: medicine.name })}
          </DialogTitle>
          <DialogDescription render={<div />}>
            <div className="space-y-2 pt-1 text-left text-foreground">
              {check.reasons.map((r, i) => (
                <p key={i}>{line(r)}</p>
              ))}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={onConfirm}>
            {t("warning.logAnyway")}
          </Button>
          <Button variant="outline" className="w-full" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
