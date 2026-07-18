"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { SafetyResult } from "@/lib/safety";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function WarningDialog({
  safety,
  open,
  onConfirm,
  onCancel,
}: {
  safety: SafetyResult | null;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  if (!safety) return null;
  const red = safety.level === "red";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle
            className={cn(
              "flex items-center gap-2",
              red ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
            )}
          >
            {red ? <OctagonAlert className="size-5" /> : <AlertTriangle className="size-5" />}
            {red ? t("warning.redTitle") : t("warning.yellowTitle")}
          </DialogTitle>
          <DialogDescription render={<div />}>
            <div className="space-y-2 pt-1 text-left">
              {safety.reasons.map((r, i) => (
                <p key={i}>
                  {t(
                    r.key,
                    Object.fromEntries(
                      Object.entries(r.params ?? {}).map(([k, v]) => [
                        k,
                        typeof v === "number" ? Math.round(v * 100) / 100 : v,
                      ]),
                    ),
                  )}
                </p>
              ))}
              {safety.nextOkAt && (
                <p className="font-medium text-foreground">
                  {t("warning.nextOk", {
                    time: formatTime(new Date(safety.nextOkAt), locale),
                  })}
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant={red ? "destructive" : "default"}
            className="w-full"
            onClick={onConfirm}
          >
            {t("warning.takeAnyway")}
          </Button>
          <Button variant="outline" className="w-full" onClick={onCancel}>
            {t("warning.wait")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
