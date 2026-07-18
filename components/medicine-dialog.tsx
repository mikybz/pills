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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/client";
import {
  colorClasses,
  MEDICINE_COLORS,
  parsePresets,
  type MedicineDTO,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const FORMS = [
  "pill",
  "tablet",
  "capsule",
  "spray",
  "drops",
  "injection",
  "liquid",
  "other",
] as const;
const UNITS = ["mg", "µg", "g", "ml", "IU", "puffs", "pcs"];

export function MedicineDialog({
  medicine,
  open,
  onClose,
  onChanged,
}: {
  medicine: MedicineDTO | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [form, setForm] = useState<string>("pill");
  const [unit, setUnit] = useState("mg");
  const [color, setColor] = useState<string>("blue");
  const [presets, setPresets] = useState("1");
  const [maxPerIntake, setMaxPerIntake] = useState("");
  const [maxPerDay, setMaxPerDay] = useState("");
  const [minInterval, setMinInterval] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(medicine?.name ?? "");
    setForm(medicine?.form ?? "pill");
    setUnit(medicine?.unit ?? "mg");
    setColor(medicine?.color ?? "blue");
    setPresets(medicine ? parsePresets(medicine).join(", ") : "1");
    setMaxPerIntake(medicine?.maxPerIntake ? String(medicine.maxPerIntake) : "");
    setMaxPerDay(medicine?.maxPerDay ? String(medicine.maxPerDay) : "");
    setMinInterval(medicine?.minIntervalMin ? String(medicine.minIntervalMin) : "");
    setNotes(medicine?.notes ?? "");
  }, [medicine, open]);

  async function save() {
    const presetList = presets
      .split(/[,\s]+/)
      .map((s) => Number(s.replace(",", ".")))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 4);
    if (!name.trim() || presetList.length === 0) {
      toast.error(tc("error"));
      return;
    }
    const body = {
      name: name.trim(),
      form,
      unit,
      color,
      presets: presetList,
      maxPerIntake: maxPerIntake ? Number(maxPerIntake) : null,
      maxPerDay: maxPerDay ? Number(maxPerDay) : null,
      minIntervalMin: minInterval ? Number(minInterval) : null,
      notes: notes.trim() || null,
    };
    try {
      await api(medicine ? `/api/medicines/${medicine.id}` : "/api/medicines", {
        method: medicine ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      toast.success(t("saved"));
      onChanged();
    } catch {
      toast.error(tc("error"));
    }
  }

  async function archive() {
    if (!medicine) return;
    if (!confirm(t("archiveConfirm"))) return;
    try {
      await api(`/api/medicines/${medicine.id}`, { method: "DELETE" });
      onChanged();
    } catch {
      toast.error(tc("error"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            {medicine ? t("editMedicine") : t("newMedicine")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">{t("name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block">{t("form")}</Label>
              <Select value={form} onValueChange={(v) => v && setForm(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(`form${f.charAt(0).toUpperCase() + f.slice(1)}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block">{t("unit")}</Label>
              <Select value={unit} onValueChange={(v) => v && setUnit(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">{t("color")}</Label>
            <div className="flex gap-2">
              {MEDICINE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-8 rounded-full transition-transform",
                    colorClasses[c].dot,
                    color === c && "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background",
                  )}
                />
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">{t("presets")}</Label>
            <Input
              value={presets}
              inputMode="text"
              placeholder="0.5, 1, 2"
              onChange={(e) => setPresets(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t("presetsHint")}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block">{t("maxPerIntake")}</Label>
              <Input
                inputMode="decimal"
                value={maxPerIntake}
                onChange={(e) => setMaxPerIntake(e.target.value.replace(",", "."))}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">{t("maxPerDay")}</Label>
              <Input
                inputMode="decimal"
                value={maxPerDay}
                onChange={(e) => setMaxPerDay(e.target.value.replace(",", "."))}
              />
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">{t("minInterval")}</Label>
            <Input
              inputMode="numeric"
              value={minInterval}
              onChange={(e) => setMinInterval(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t("minIntervalHint")}</p>
          </div>

          <div>
            <Label className="mb-1.5 block">{t("notes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="flex-row gap-2">
          {medicine && (
            <Button variant="destructive" onClick={archive}>
              {t("archive")}
            </Button>
          )}
          <Button className="flex-1" onClick={save}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
