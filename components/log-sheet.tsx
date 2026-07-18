"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Minus, Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parsePresets, type MedicineDTO } from "@/lib/types";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DoseStatus } from "@/lib/safety";

export interface LogRequest {
  amount: number;
  takenAt: Date;
  status: DoseStatus;
  note?: string;
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LogSheet({
  medicine,
  open,
  onOpenChange,
  onSubmit,
}: {
  medicine: MedicineDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (req: LogRequest) => void;
}) {
  const t = useTranslations("logSheet");
  const [amount, setAmount] = useState<string>("");
  const [offsetMin, setOffsetMin] = useState<number | "custom">(0);
  const [customTime, setCustomTime] = useState<string>("");
  const [status, setStatus] = useState<DoseStatus>("taken");
  const [note, setNote] = useState("");

  if (!medicine) return null;
  const presets = parsePresets(medicine);
  const step = Math.min(...presets) / 2;
  const currentAmount = amount === "" ? (medicine.defaultPreset ?? presets[0]) : Number(amount);

  const timeChips: { label: string; value: number | "custom" }[] = [
    { label: t("now"), value: 0 },
    { label: t("minutesAgo", { minutes: 15 }), value: 15 },
    { label: t("hoursAgo", { hours: 1 }), value: 60 },
    { label: t("hoursAgo", { hours: 2 }), value: 120 },
    { label: t("customTime"), value: "custom" },
  ];

  const statuses: { label: string; value: DoseStatus }[] = [
    { label: t("statusTaken"), value: "taken" },
    { label: t("statusUncertain"), value: "uncertain" },
    { label: t("statusSkipped"), value: "skipped" },
  ];

  function reset() {
    setAmount("");
    setOffsetMin(0);
    setCustomTime("");
    setStatus("taken");
    setNote("");
  }

  function submit() {
    let takenAt = new Date();
    if (offsetMin === "custom") {
      if (!customTime) return;
      takenAt = new Date(customTime);
    } else if (offsetMin > 0) {
      takenAt = new Date(Date.now() - offsetMin * 60_000);
    }
    if (!Number.isFinite(currentAmount) || currentAmount <= 0) return;
    onSubmit({ amount: currentAmount, takenAt, status, note: note.trim() || undefined });
    reset();
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{t("title", { name: medicine.name })}</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <div>
            <Label className="mb-2 block">{t("amount", { unit: medicine.unit })}</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="-"
                onClick={() => setAmount(formatAmount(Math.max(step, currentAmount - step)))}
              >
                <Minus className="size-4" />
              </Button>
              <Input
                inputMode="decimal"
                className="text-center text-lg font-semibold"
                value={amount === "" ? formatAmount(currentAmount) : amount}
                onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="+"
                onClick={() => setAmount(formatAmount(currentAmount + step))}
              >
                <Plus className="size-4" />
              </Button>
            </div>
            <div className="mt-2 flex gap-2">
              {presets.map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant={currentAmount === p ? "default" : "outline"}
                  onClick={() => setAmount(formatAmount(p))}
                >
                  {formatAmount(p)}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">{t("when")}</Label>
            <div className="flex flex-wrap gap-2">
              {timeChips.map((c) => (
                <Button
                  key={String(c.value)}
                  type="button"
                  size="sm"
                  variant={offsetMin === c.value ? "default" : "outline"}
                  onClick={() => {
                    setOffsetMin(c.value);
                    if (c.value === "custom" && !customTime) {
                      setCustomTime(toLocalInputValue(new Date()));
                    }
                  }}
                >
                  {c.label}
                </Button>
              ))}
            </div>
            {offsetMin === "custom" && (
              <Input
                type="datetime-local"
                className="mt-2"
                value={customTime}
                max={toLocalInputValue(new Date())}
                onChange={(e) => setCustomTime(e.target.value)}
              />
            )}
          </div>

          <div>
            <Label className="mb-2 block">{t("status")}</Label>
            <div className="flex flex-col gap-1.5">
              {statuses.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStatus(s.value)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left text-sm",
                    status === s.value
                      ? "border-teal-500 bg-teal-500/10 font-medium"
                      : "border-border",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">{t("note")}</Label>
            <Input
              value={note}
              placeholder={t("notePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <Button className="w-full" size="lg" onClick={submit}>
            {t("log")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
