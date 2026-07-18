"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client";
import type { DoseDTO, MedicineDTO } from "@/lib/types";
import type { DoseStatus } from "@/lib/safety";
import { cn } from "@/lib/utils";

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditDoseDialog({
  dose,
  medicine,
  onClose,
  onChanged,
}: {
  dose: DoseDTO | null;
  medicine: MedicineDTO | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const [amount, setAmount] = useState("");
  const [takenAt, setTakenAt] = useState("");
  const [status, setStatus] = useState<DoseStatus>("taken");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (dose) {
      setAmount(String(dose.amount));
      setTakenAt(toLocalInputValue(new Date(dose.takenAt)));
      setStatus(dose.status as DoseStatus);
      setNote(dose.note ?? "");
    }
  }, [dose]);

  if (!dose) return null;

  async function save() {
    try {
      await api(`/api/doses/${dose!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          amount: Number(amount),
          takenAt: new Date(takenAt).toISOString(),
          status,
          note: note.trim() || null,
        }),
      });
      toast.success(t("history.saved"));
      onChanged();
    } catch {
      toast.error(t("common.error"));
    }
  }

  async function remove() {
    try {
      await api(`/api/doses/${dose!.id}`, { method: "DELETE" });
      toast.success(t("history.deleted"));
      onChanged();
    } catch {
      toast.error(t("common.error"));
    }
  }

  const statuses: { label: string; value: DoseStatus }[] = [
    { label: t("logSheet.statusTaken"), value: "taken" },
    { label: t("logSheet.statusUncertain"), value: "uncertain" },
    { label: t("logSheet.statusSkipped"), value: "skipped" },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("history.edit")} — {medicine?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">
              {t("logSheet.amount", { unit: medicine?.unit ?? "" })}
            </Label>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">{t("logSheet.when")}</Label>
            <Input
              type="datetime-local"
              value={takenAt}
              onChange={(e) => setTakenAt(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">{t("logSheet.status")}</Label>
            <div className="flex flex-col gap-1.5">
              {statuses.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStatus(s.value)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm",
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
            <Label className="mb-1.5 block">{t("logSheet.note")}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button variant="destructive" onClick={remove}>
            {t("history.delete")}
          </Button>
          <Button className="flex-1" onClick={save}>
            {t("settings.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
