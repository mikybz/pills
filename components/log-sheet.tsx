"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Minus, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateTimeField } from "@/components/time-field";
import { doseAmountOf, parsePresets, type MedicineDTO } from "@/lib/types";
import { formatAmount, unitLabel } from "@/lib/format";
import { isScheduled, type DoseStatus } from "@/lib/schedule";
import { cn } from "@/lib/utils";

export interface LogRequest {
  amount: number;
  /** Omitted = now (resolved when the log is sent). */
  takenAt?: number;
  status: DoseStatus;
  note?: string;
  /** The slot (row) this log answers; undefined = let the app assign it. */
  slotAt?: number;
}

/**
 * The ⋯ sheet: custom amount, taken earlier, not sure, skip, note.
 * Render it only while open; it starts fresh each time.
 */
export function LogSheet({
  medicine,
  timeZone,
  slotAt,
  initialAt,
  onClose,
  onSubmit,
}: {
  medicine: MedicineDTO;
  timeZone: string;
  slotAt?: number;
  /** Prefill "taken at" (e.g. the scheduled time from history). */
  initialAt?: number;
  onClose: () => void;
  onSubmit: (req: LogRequest) => void;
}) {
  const t = useTranslations();
  const presets = isScheduled(medicine.mode) ? [doseAmountOf(medicine)] : parsePresets(medicine);
  const fallback = doseAmountOf(medicine);
  const [amount, setAmount] = useState(formatAmount(fallback));
  const [offsetMin, setOffsetMin] = useState<number | "custom">(initialAt ? "custom" : 0);
  const [customAt, setCustomAt] = useState<number | null>(initialAt ?? null);
  const [status, setStatus] = useState<DoseStatus>("taken");
  const [note, setNote] = useState("");

  const step = Math.min(...presets) / 2;
  const current = Number(amount);
  const unit = unitLabel(medicine.unit, t);

  const timeChips: { label: string; value: number | "custom" }[] = [
    { label: t("logSheet.now"), value: 0 },
    { label: t("logSheet.minutesAgo", { minutes: 15 }), value: 15 },
    { label: t("logSheet.hoursAgo", { hours: 1 }), value: 60 },
    { label: t("logSheet.hoursAgo", { hours: 2 }), value: 120 },
    { label: t("logSheet.customTime"), value: "custom" },
  ];

  const statuses: { label: string; value: DoseStatus }[] = [
    { label: t("logSheet.statusTaken"), value: "taken" },
    { label: t("logSheet.statusUncertain"), value: "uncertain" },
    { label: t("logSheet.statusSkipped"), value: "skipped" },
  ];

  function submit() {
    const now = Date.now();
    const takenAt =
      offsetMin === "custom" ? Math.min(customAt ?? now, now) : now - offsetMin * 60_000;
    if (!Number.isFinite(current) || current <= 0) return;
    onSubmit({ amount: current, takenAt, status, note: note.trim() || undefined, slotAt });
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{t("logSheet.title", { name: medicine.name })}</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <div>
            <Label className="mb-2 block">{t("logSheet.amount", { unit })}</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="-"
                onClick={() => setAmount(formatAmount(Math.max(step, (current || fallback) - step)))}
              >
                <Minus className="size-4" />
              </Button>
              <Input
                inputMode="decimal"
                className="text-center text-lg font-semibold"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="+"
                onClick={() => setAmount(formatAmount((current || 0) + step))}
              >
                <Plus className="size-4" />
              </Button>
            </div>
            {presets.length > 1 && (
              <div className="mt-2 flex gap-2">
                {presets.map((p) => (
                  <Button
                    key={p}
                    type="button"
                    size="sm"
                    variant={current === p ? "default" : "outline"}
                    onClick={() => setAmount(formatAmount(p))}
                  >
                    {formatAmount(p)}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label className="mb-2 block">{t("logSheet.when")}</Label>
            <div className="flex flex-wrap gap-2">
              {timeChips.map((c) => (
                <Button
                  key={String(c.value)}
                  type="button"
                  size="sm"
                  variant={offsetMin === c.value ? "default" : "outline"}
                  onClick={() => {
                    setOffsetMin(c.value);
                    if (c.value === "custom" && customAt === null) setCustomAt(Date.now());
                  }}
                >
                  {c.label}
                </Button>
              ))}
            </div>
            {offsetMin === "custom" && customAt !== null && (
              <div className="mt-2">
                <DateTimeField value={customAt} onChange={setCustomAt} timeZone={timeZone} />
              </div>
            )}
          </div>

          <div>
            <Label className="mb-2 block">{t("logSheet.status")}</Label>
            <div className="flex flex-col gap-1.5">
              {statuses.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStatus(s.value)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left text-sm",
                    status === s.value ? "border-teal-500 bg-teal-500/10 font-medium" : "border-border",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">{t("logSheet.note")}</Label>
            <Input
              value={note}
              placeholder={t("logSheet.notePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <Button className="w-full" size="lg" onClick={submit}>
            {t("logSheet.log")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
