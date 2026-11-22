"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimeField } from "@/components/time-field";
import { useBlockReload } from "@/components/update-check";
import { api } from "@/lib/client";
import { minutesOf, sortTimes, timeOf } from "@/lib/schedule";
import { addDays, localDate, zonedToUtc } from "@/lib/tz";
import { colorClasses, MEDICINE_COLORS, parseTimes, type MedicineDTO } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

type CareKind = "task" | "measure";
/** flex: at the latest every …; once: on a date; fixed: every day at set times; asNeeded: any time. */
type CareMode = "flex" | "once" | "fixed" | "asNeeded";
type Span = "days" | "weeks";
type LastDone = "today" | "never" | "date";

const MODES: Record<CareKind, CareMode[]> = { task: ["flex", "once"], measure: ["flex", "fixed", "asNeeded"] };
const UNIT_HINTS = ["kg", "°C", "mmHg", "mmol/L", "cm", "bpm"];

const toSpan = (days: number | null | undefined, fallback: number): { n: string; span: Span } => {
  const d = days ?? fallback;
  return d % 7 === 0 ? { n: String(d / 7), span: "weeks" } : { n: String(d), span: "days" };
};
const daysOf = (n: string, span: Span) => Math.round(Number(n.replace(",", "."))) * (span === "weeks" ? 7 : 1);

function initialState(m: MedicineDTO | null, kind: CareKind, defaultColor: string, today: string) {
  const mode = (m?.mode && MODES[kind].includes(m.mode as CareMode) ? m.mode : "flex") as CareMode;
  const max = toSpan(m?.maxDays, kind === "measure" ? 28 : 14);
  const min = toSpan(m?.minDays, 7);
  const times = sortTimes(parseTimes(m?.times));
  return {
    name: m?.name ?? "",
    mode,
    maxN: max.n,
    maxSpan: max.span,
    minN: m?.minDays ? min.n : "",
    minSpan: min.span,
    dueOn: m?.dueOn ?? addDays(today, 1),
    hasTime: mode === "once" && times.length > 0,
    time: (mode === "once" && times[0]) || "10:00",
    times: mode === "fixed" && times.length ? times : ["08:00"],
    unit: kind === "measure" ? (m?.unit ?? "kg") : "pcs",
    lastDone: "today" as LastDone,
    lastDate: addDays(today, -7),
    color: m?.color ?? defaultColor,
    remindersEnabled: m?.remindersEnabled ?? true,
    notes: m?.notes ?? "",
  };
}

/**
 * Add / edit a task (care task or dated to-do) or a measurement (PLAN.md §15).
 * Same storage as medicines (`kind`); render only while open.
 */
export function CareDialog({
  item,
  kind,
  personId,
  timeZone,
  showReminderSwitch,
  defaultColor = "teal",
  onClose,
  onChanged,
}: {
  item: MedicineDTO | null;
  kind: CareKind;
  personId?: string;
  timeZone: string;
  showReminderSwitch: boolean;
  defaultColor?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations();
  useBlockReload();
  const now = useNow();
  const today = localDate(now, timeZone);
  const [s, setS] = useState(() => initialState(item, kind, defaultColor, today));
  const [more, setMore] = useState(false);
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((p) => ({ ...p, [k]: v }));

  const spanPicker = (n: string, span: Span, onN: (v: string) => void, onSpan: (v: Span) => void, placeholder?: string) => (
    <span className="inline-flex items-center gap-1.5">
      <Input
        inputMode="numeric"
        className="w-16 text-center"
        value={n}
        placeholder={placeholder}
        onChange={(e) => onN(e.target.value.replace(/[^\d]/g, ""))}
      />
      {(["days", "weeks"] as const).map((u) => (
        <Button key={u} type="button" size="sm" variant={span === u ? "default" : "outline"} onClick={() => onSpan(u)}>
          {t(`care.${u}`)}
        </Button>
      ))}
    </span>
  );

  async function save() {
    const name = s.name.trim();
    if (!name || (kind === "measure" && !s.unit.trim())) {
      toast.error(t("care.invalid"));
      return;
    }
    const maxDays = daysOf(s.maxN, s.maxSpan);
    const minDays = s.minN.trim() ? daysOf(s.minN, s.minSpan) : null;
    if (s.mode === "flex" && (!(maxDays >= 1) || (minDays !== null && !(minDays >= 1 && minDays < maxDays)))) {
      toast.error(t("care.invalidSpan"));
      return;
    }
    const body = {
      name,
      kind,
      form: "other",
      unit: kind === "measure" ? s.unit.trim() : "pcs",
      color: s.color,
      notes: s.notes.trim() || null,
      presets: [1],
      defaultPreset: null,
      doseAmount: null,
      maxPerDay: null,
      maxPerIntake: null,
      mode: s.mode,
      maxDays: s.mode === "flex" ? maxDays : null,
      minDays: s.mode === "flex" ? minDays : null,
      dueOn: s.mode === "once" ? s.dueOn : null,
      times: s.mode === "fixed" ? sortTimes(s.times) : s.mode === "once" && s.hasTime ? [s.time] : null,
      intervalH: null,
      weekdays: null,
      everyDays: null,
      startsOn: null,
      endsOn: null,
      remindersEnabled: s.remindersEnabled,
      confirmSchedule: true,
    };
    // A new regular task starts counting from when it was last done (saved as its first log).
    const lastDoneAt =
      !item && kind === "task" && s.mode === "flex" && s.lastDone !== "never"
        ? new Date(s.lastDone === "today" ? Date.now() : zonedToUtc(s.lastDate, "12:00", timeZone)).toISOString()
        : undefined;
    try {
      await api<MedicineDTO>(item ? `/api/medicines/${item.id}` : "/api/medicines", {
        method: item ? "PATCH" : "POST",
        body: JSON.stringify(item ? body : { ...body, personId, lastDoneAt }),
      });
      toast.success(t("settings.saved"));
      onChanged();
    } catch {
      toast.error(t("common.error"));
    }
  }

  async function archive() {
    if (!item || !confirm(t("care.archiveConfirm"))) return;
    try {
      await api(`/api/medicines/${item.id}`, { method: "DELETE" });
      onChanged();
    } catch {
      toast.error(t("common.error"));
    }
  }

  const title = item ? t(`care.edit_${kind}`) : t(`care.new_${kind}`);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div>
            <Label className="mb-1.5 block">{t("medicine.name")}</Label>
            <Input
              value={s.name}
              placeholder={t(`care.namePlaceholder_${kind}`)}
              onChange={(e) => set("name", e.target.value)}
              autoFocus={!item}
            />
          </div>

          {kind === "measure" && (
            <div>
              <Label className="mb-1.5 block">{t("care.unit")}</Label>
              <Input value={s.unit} className="w-28" onChange={(e) => set("unit", e.target.value)} maxLength={12} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {UNIT_HINTS.map((u) => (
                  <Button key={u} type="button" size="xs" variant={s.unit === u ? "default" : "outline"} onClick={() => set("unit", u)}>
                    {u}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label className="mb-1.5 block">{t("medicine.howOften")}</Label>
            <div className="flex flex-wrap gap-2">
              {MODES[kind].map((m) => (
                <Button key={m} type="button" size="sm" variant={s.mode === m ? "default" : "outline"} onClick={() => set("mode", m)}>
                  {t(`care.mode_${m}`)}
                </Button>
              ))}
            </div>
          </div>

          {s.mode === "flex" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="block">{t("care.atLatest")}</Label>
                {spanPicker(s.maxN, s.maxSpan, (v) => set("maxN", v), (v) => set("maxSpan", v))}
              </div>
              <div className="space-y-1.5">
                <Label className="block">{t("care.notMoreOften")}</Label>
                {spanPicker(s.minN, s.minSpan, (v) => set("minN", v), (v) => set("minSpan", v), "–")}
                <p className="text-xs text-muted-foreground">{t("care.notMoreOftenHint")}</p>
              </div>
              {!item && kind === "task" && (
                <div className="space-y-1.5">
                  <Label className="block">{t("care.lastDoneQ")}</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {(["today", "date", "never"] as const).map((v) => (
                      <Button key={v} type="button" size="sm" variant={s.lastDone === v ? "default" : "outline"} onClick={() => set("lastDone", v)}>
                        {t(`care.lastDone_${v}`)}
                      </Button>
                    ))}
                    {s.lastDone === "date" && (
                      <Input
                        type="date"
                        className="h-9 w-auto"
                        value={s.lastDate}
                        max={today}
                        onChange={(e) => e.target.value && set("lastDate", e.target.value)}
                      />
                    )}
                  </div>
                </div>
              )}
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{t("care.flexHint")}</p>
            </div>
          )}

          {s.mode === "once" && (
            <div className="space-y-2">
              <Label className="block">{t("care.dueOn")}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input type="date" className="h-10 w-auto" value={s.dueOn} onChange={(e) => e.target.value && set("dueOn", e.target.value)} />
                {s.hasTime ? (
                  <span className="inline-flex items-center">
                    <TimeField value={s.time} label={t("care.time")} onChange={(v) => set("time", v)} />
                    <Button type="button" variant="ghost" size="icon" aria-label={t("care.noTime")} onClick={() => set("hasTime", false)}>
                      <X className="size-4" />
                    </Button>
                  </span>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => set("hasTime", true)}>
                    <Plus className="size-4" /> {t("care.addTime")}
                  </Button>
                )}
              </div>
            </div>
          )}

          {s.mode === "fixed" && (
            <div>
              <Label className="mb-1.5 block">{t("medicine.times")}</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {s.times.map((time, i) => (
                  <span key={i} className="inline-flex items-center">
                    <TimeField
                      value={time}
                      label={t("medicine.timeN", { n: i + 1 })}
                      onChange={(v) => setS((p) => ({ ...p, times: p.times.map((x, j) => (j === i ? v : x)) }))}
                    />
                    {s.times.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("medicine.removeTime")}
                        onClick={() => setS((p) => ({ ...p, times: p.times.filter((_, j) => j !== i) }))}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </span>
                ))}
                {s.times.length < 6 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10"
                    onClick={() => setS((p) => ({ ...p, times: [...p.times, timeOf(minutesOf(p.times[p.times.length - 1]) + 12 * 60)] }))}
                  >
                    <Plus className="size-4" /> {t("medicine.addTime")}
                  </Button>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            className="flex w-full items-center justify-between border-t pt-3 text-sm font-medium"
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
          >
            {t("medicine.moreOptions")}
            <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} />
          </button>

          {more && (
            <div className="space-y-4">
              {showReminderSwitch && s.mode !== "asNeeded" && (
                <div className="flex items-center justify-between gap-4">
                  <Label>{t("care.reminders")}</Label>
                  <Switch checked={s.remindersEnabled} onCheckedChange={(v) => set("remindersEnabled", v)} />
                </div>
              )}
              <div>
                <Label className="mb-1.5 block">{t("medicine.color")}</Label>
                <div className="flex gap-2">
                  {MEDICINE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      onClick={() => set("color", c)}
                      className={cn(
                        "size-8 rounded-full transition-transform",
                        colorClasses[c].dot,
                        s.color === c && "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background",
                      )}
                    />
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block">{t("medicine.notes")}</Label>
                <Input value={s.notes} onChange={(e) => set("notes", e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="flex-row gap-2">
          {item && !item.archivedAt && (
            <Button variant="destructive" onClick={archive}>
              {t("medicine.archive")}
            </Button>
          )}
          <Button className="flex-1" onClick={save}>
            {item ? t("common.save") : <><Plus className="size-4" /> {t("medicine.add")}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
