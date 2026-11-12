"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, Pencil, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { describeSchedule } from "@/lib/describe";
import { colorClasses, type MedicineDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One-time review of auto-guessed schedules for medicines that existed before
 * schedules. Until confirmed, a medicine sends no reminders and derives no
 * missed doses.
 */
export function ReviewScreen({
  medicines,
  personName,
  onConfirm,
  onConfirmAll,
  onChange,
  onClose,
}: {
  medicines: MedicineDTO[];
  personName: string | null;
  onConfirm: (m: MedicineDTO) => void;
  onConfirmAll: () => void;
  onChange: (m: MedicineDTO) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{t("review.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {personName ? t("review.introFor", { name: personName }) : t("review.intro")}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label={t("common.close")} onClick={onClose}>
          <X className="size-5" />
        </Button>
      </div>
      <Card className="gap-0 p-0">
        <ul className="divide-y">
          {medicines.map((m) => (
            <li key={m.id} className="space-y-2 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <span
                  className={cn("mt-1 h-8 w-1 shrink-0 rounded-full", (colorClasses[m.color] ?? colorClasses.blue).dot)}
                  aria-hidden
                />
                <p>
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted-foreground">: </span>
                  {describeSchedule(m, t, locale)}
                </p>
              </div>
              <div className="flex gap-2 pl-3.5">
                <Button size="sm" onClick={() => onConfirm(m)}>
                  <Check className="size-4" /> {t("review.looksRight")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => onChange(m)}>
                  <Pencil className="size-4" /> {t("review.change")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {medicines.length > 1 && (
        <Button className="w-full" size="lg" variant="secondary" onClick={onConfirmAll}>
          {t("review.confirmAll")}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">{t("review.footnote")}</p>
    </div>
  );
}
