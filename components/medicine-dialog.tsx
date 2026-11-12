"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown, Moon, Plus } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimeField } from "@/components/time-field";
import { api } from "@/lib/client";
import { formatAmount, formatDuration, formatList, unitLabel } from "@/lib/format";
import {
  DEFAULT_TIMES,
  evenlySpaced,
  isNight,
  minutesOf,
  sortTimes,
  timeOf,
} from "@/lib/schedule";
import { addDays, daysBetween, localDate } from "@/lib/tz";
import {
  colorClasses,
  doseAmountOf,
  MEDICINE_COLORS,
  parsePresets,
  parseTimes,
  type MedicineDTO,
} from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const FORMS = ["pill", "tablet", "capsule", "spray", "drops", "injection", "liquid", "other"] as const;
const UNITS = ["pcs", "mg", "µg", "g", "ml", "IU", "puffs"];

type Freq = "1" | "2" | "3" | "4" | "everyN" | "asNeeded";
type Course = "none" | "days" | "date";

const num = (s: string) => Number(s.replace(",", "."));
const optNum = (s: string) => (s.trim() === "" ? null : num(s));

function initialState(m: MedicineDTO | null, defaultColor: string) {
  const times = sortTimes(parseTimes(m?.times));
  let freq: Freq = "1";
  let everyH = "8";
  let everyKind: "fixed" | "interval" = "fixed";
  if (m?.mode === "interval") {
    freq = "everyN";
    everyH = formatAmount(m.intervalH ?? 8);
    everyKind = "interval";
  } else if (m?.mode === "fixed" && times.length) {
    if (times.length <= 4) freq = String(times.length) as Freq;
    else {
      freq = "everyN";
      everyH = formatAmount(Math.round((24 / times.length) * 10) / 10);
    }
  } else if (m) {
    freq = "asNeeded";
  }
  return {
    name: m?.name ?? "",
    freq,
    everyH,
    everyKind,
    times: times.length ? times : DEFAULT_TIMES[1],
    dose: formatAmount(m ? doseAmountOf(m) : 1),
    unit: m?.unit ?? "pcs",
    maxPerDay: m?.maxPerDay ? formatAmount(m.maxPerDay) : "",
    maxPerIntake: m?.maxPerIntake ? formatAmount(m.maxPerIntake) : "",
    minGapH: m?.minIntervalMin ? formatAmount(Math.round((m.minIntervalMin / 60) * 100) / 100) : "",
    presets: m ? parsePresets(m).map(formatAmount).join(", ") : "",
    course: (m?.endsOn ? "date" : "none") as Course,
    courseDays: "7",
    startsOn: m?.startsOn ?? null,
    endsOn: m?.endsOn ?? "",
    remindersEnabled: m?.remindersEnabled ?? true,
    form: m?.form ?? "pill",
    color: m?.color ?? defaultColor,
    notes: m?.notes ?? "",
  };
}

/**
 * Add / edit medicine. Simple first: name, how often, dose. Everything else is
 * under "More options". Render only while open (state starts from `medicine`).
 */
export function MedicineDialog({
  medicine,
  personId,
  timeZone,
  showReminderSwitch,
  defaultColor = "blue",
  onClose,
  onChanged,
}: {
  medicine: MedicineDTO | null;
  /** Person a new medicine is created for. */
  personId?: string;
  timeZone: string;
  /** Hidden on devices that cannot show notifications (no dead settings). */
  showReminderSwitch: boolean;
  /** Color for a new medicine (the first one not used yet). */
  defaultColor?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const now = useNow();
  const [s, setS] = useState(() => initialState(medicine, defaultColor));
  const [more, setMore] = useState(false);
  const [shiftBy, setShiftBy] = useState<number | null>(null);
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((p) => ({ ...p, [k]: v }));

  const hours = num(s.everyH);
  const evenDivisor = Number.isFinite(hours) && hours >= 1 && Number.isInteger(24 / hours);
  const isFixed = ["1", "2", "3", "4"].includes(s.freq) || (s.freq === "everyN" && s.everyKind === "fixed" && evenDivisor);
  const isInterval = s.freq === "everyN" && !isFixed;
  const isAsNeeded = s.freq === "asNeeded";

  function timesForEvery(h: number, first?: string) {
    const count = 24 / h;
    if (!first && DEFAULT_TIMES[count]) return DEFAULT_TIMES[count];
    return evenlySpaced(first ?? "08:00", count, h);
  }

  function chooseFreq(f: Freq) {
    setShiftBy(null);
    setS((p) => {
      const next = { ...p, freq: f };
      if (["1", "2", "3", "4"].includes(f)) next.times = DEFAULT_TIMES[Number(f)];
      if (f === "everyN") {
        const h = num(p.everyH);
        next.everyKind = Number.isInteger(24 / h) ? p.everyKind : "interval";
        if (Number.isInteger(24 / h)) next.times = timesForEvery(h);
      }
      return next;
    });
  }

  function setEveryH(v: string) {
    setShiftBy(null);
    setS((p) => {
      const h = num(v);
      const next = { ...p, everyH: v };
      if (Number.isFinite(h) && h > 0 && Number.isInteger(24 / h)) next.times = timesForEvery(h, p.times[0]);
      else next.everyKind = "interval";
      return next;
    });
  }

  function setTime(i: number, v: string) {
    setS((p) => {
      const times = [...p.times];
      if (i === 0 && times.length > 1) setShiftBy(minutesOf(v) - minutesOf(times[0]));
      else setShiftBy(null);
      times[i] = v;
      return { ...p, times };
    });
  }

  function shiftOthers() {
    if (shiftBy === null) return;
    setS((p) => ({ ...p, times: p.times.map((x, i) => (i === 0 ? x : timeOf(minutesOf(x) + shiftBy))) }));
    setShiftBy(null);
  }

  const nightTimes = isFixed ? sortTimes(s.times).filter(isNight) : [];
  const today = localDate(now, timeZone);

  async function save() {
    const dose = num(s.dose);
    if (!s.name.trim() || !Number.isFinite(dose) || dose <= 0) {
      toast.error(t("medicine.invalid"));
      return;
    }
    const minGap = optNum(s.minGapH);
    let startsOn = s.startsOn;
    let endsOn: string | null = null;
    if (s.course === "days") {
      const n = Math.max(1, Math.round(num(s.courseDays)));
      startsOn = startsOn && startsOn <= today ? startsOn : today;
      // "For 7 days" counts from today; earlier days of an ongoing course stay.
      endsOn = addDays(today, n - 1);
      if (daysBetween(startsOn, endsOn) < 0) startsOn = endsOn;
    } else if (s.course === "date") {
      endsOn = s.endsOn || null;
      if (endsOn && startsOn && endsOn < startsOn) startsOn = null;
    } else {
      startsOn = null;
    }

    const common = {
      name: s.name.trim(),
      form: s.form,
      unit: s.unit,
      color: s.color,
      notes: s.notes.trim() || null,
      doseAmount: dose,
      startsOn,
      endsOn,
      remindersEnabled: s.remindersEnabled,
      minIntervalMin: minGap && minGap > 0 ? Math.round(minGap * 60) : null,
      confirmSchedule: true,
    };
    let body: Record<string, unknown>;
    if (isAsNeeded) {
      const presets = s.presets
        .split(/[\s,;]+/)
        .map(num)
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, 4);
      const list = presets.length ? presets : [dose];
      body = {
        ...common,
        mode: "asNeeded",
        presets: list,
        defaultPreset: list.includes(dose) ? dose : list[0],
        maxPerDay: optNum(s.maxPerDay),
        maxPerIntake: optNum(s.maxPerIntake),
        times: null,
        intervalH: null,
      };
    } else if (isFixed) {
      body = { ...common, mode: "fixed", presets: [dose], defaultPreset: dose, times: sortTimes(s.times), intervalH: null };
    } else {
      if (!Number.isFinite(hours) || hours < 1) {
        toast.error(t("medicine.invalid"));
        return;
      }
      body = { ...common, mode: "interval", presets: [dose], defaultPreset: dose, times: null, intervalH: hours };
    }
    try {
      await api(medicine ? `/api/medicines/${medicine.id}` : "/api/medicines", {
        method: medicine ? "PATCH" : "POST",
        body: JSON.stringify(medicine ? body : { ...body, personId }),
      });
      toast.success(t("settings.saved"));
      onChanged();
    } catch {
      toast.error(t("common.error"));
    }
  }

  async function archive() {
    if (!medicine || !confirm(t("medicine.archiveConfirm"))) return;
    try {
      await api(`/api/medicines/${medicine.id}`, { method: "DELETE" });
      onChanged();
    } catch {
      toast.error(t("common.error"));
    }
  }

  const freqChips: { value: Freq; label: string }[] = [
    { value: "1", label: t("medicine.freq1") },
    { value: "2", label: t("medicine.freq2") },
    { value: "3", label: t("medicine.freq3") },
    { value: "4", label: t("medicine.freq4") },
    { value: "everyN", label: t("medicine.freqEvery") },
    { value: "asNeeded", label: t("medicine.freqAsNeeded") },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{medicine ? t("medicine.edit") : t("medicine.new")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div>
            <Label className="mb-1.5 block">{t("medicine.name")}</Label>
            <Input value={s.name} onChange={(e) => set("name", e.target.value)} autoFocus={!medicine} />
          </div>

          <div>
            <Label className="mb-1.5 block">{t("medicine.howOften")}</Label>
            <div className="flex flex-wrap gap-2">
              {freqChips.map((c) => (
                <Button
                  key={c.value}
                  type="button"
                  size="sm"
                  variant={s.freq === c.value ? "default" : "outline"}
                  onClick={() => chooseFreq(c.value)}
                >
                  {c.label}
                </Button>
              ))}
            </div>
          </div>

          {s.freq === "everyN" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>{t("medicine.everyLabel")}</Label>
                <Input
                  inputMode="decimal"
                  className="w-16 text-center"
                  value={s.everyH}
                  onChange={(e) => setEveryH(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">{t("medicine.hours")}</span>
              </div>
              <div className="grid gap-1.5">
                {(
                  [
                    { kind: "fixed", title: t("medicine.everyFixed"), hint: t("medicine.everyFixedHint") },
                    { kind: "interval", title: t("medicine.everyInterval"), hint: t("medicine.everyIntervalHint") },
                  ] as const
                ).map((o) => {
                  const disabled = o.kind === "fixed" && !evenDivisor;
                  const active = o.kind === "fixed" ? isFixed : isInterval;
                  return (
                    <button
                      key={o.kind}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        set("everyKind", o.kind);
                        if (o.kind === "fixed") set("times", timesForEvery(hours, s.times[0]));
                      }}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50",
                        active ? "border-teal-500 bg-teal-500/10" : "border-border",
                      )}
                    >
                      <span className="block font-medium">{o.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {disabled ? t("medicine.everyFixedUneven") : o.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isFixed && (
            <div>
              <Label className="mb-1.5 block">{t("medicine.times")}</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {s.times.map((time, i) => (
                  <TimeField
                    key={i}
                    value={time}
                    label={t("medicine.timeN", { n: i + 1 })}
                    onChange={(v) => setTime(i, v)}
                  />
                ))}
              </div>
              {shiftBy !== null && shiftBy !== 0 && (
                <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={shiftOthers}>
                  {t(shiftBy > 0 ? "medicine.shiftLater" : "medicine.shiftEarlier", {
                    by: formatDuration(Math.abs(shiftBy) * 60_000, t),
                  })}
                </Button>
              )}
            </div>
          )}

          {nightTimes.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
              <Moon className="mt-0.5 size-4 shrink-0" />
              {t("medicine.nightHint", { count: nightTimes.length, times: formatList(nightTimes, locale) })}
            </p>
          )}
          {isInterval && hours < 12 && (
            <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
              <Moon className="mt-0.5 size-4 shrink-0" />
              {t("medicine.nightHintInterval")}
            </p>
          )}

          <div>
            <Label className="mb-1.5 block">{t("medicine.dose")}</Label>
            <div className="flex gap-2">
              <Input
                inputMode="decimal"
                className="w-20 text-center"
                value={s.dose}
                onChange={(e) => set("dose", e.target.value)}
              />
              <Select value={s.unit} onValueChange={(v) => v && set("unit", v)}>
                <SelectTrigger className="flex-1">
                  <SelectValue>{(v: string) => unitLabel(v, t)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {unitLabel(u, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isAsNeeded && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">{t("medicine.maxPerDay")}</Label>
                <Input inputMode="decimal" value={s.maxPerDay} onChange={(e) => set("maxPerDay", e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block">{t("medicine.minHoursBetween")}</Label>
                <Input inputMode="decimal" value={s.minGapH} onChange={(e) => set("minGapH", e.target.value)} />
              </div>
              <p className="col-span-2 -mt-1 text-xs text-muted-foreground">{t("medicine.asNeededHint")}</p>
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
              <div>
                <Label className="mb-1.5 block">{t("medicine.course")}</Label>
                <div className="flex flex-wrap gap-2">
                  {(["none", "days", "date"] as const).map((c) => (
                    <Button
                      key={c}
                      type="button"
                      size="sm"
                      variant={s.course === c ? "default" : "outline"}
                      onClick={() => set("course", c)}
                    >
                      {t(`medicine.course_${c}`)}
                    </Button>
                  ))}
                </div>
                {s.course === "days" && (
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    {t("medicine.forPrefix")}
                    <Input
                      inputMode="numeric"
                      className="w-16 text-center"
                      value={s.courseDays}
                      onChange={(e) => set("courseDays", e.target.value.replace(/\D/g, ""))}
                    />
                    {t("medicine.daysFromToday")}
                  </div>
                )}
                {s.course === "date" && (
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    {t("medicine.lastDay")}
                    <Input
                      type="date"
                      className="w-auto"
                      value={s.endsOn}
                      onChange={(e) => set("endsOn", e.target.value)}
                    />
                  </div>
                )}
              </div>

              {showReminderSwitch && !isAsNeeded && (
                <div className="flex items-center justify-between gap-4">
                  <Label>{t("medicine.reminders")}</Label>
                  <Switch checked={s.remindersEnabled} onCheckedChange={(v) => set("remindersEnabled", v)} />
                </div>
              )}

              {!isAsNeeded && (
                <div>
                  <Label className="mb-1.5 block">{t("medicine.minGap")}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      inputMode="decimal"
                      className="w-20 text-center"
                      value={s.minGapH}
                      onChange={(e) => set("minGapH", e.target.value)}
                    />
                    <span className="text-sm text-muted-foreground">{t("medicine.hours")}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t("medicine.minGapHint")}</p>
                </div>
              )}

              {isAsNeeded && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="mb-1.5 block">{t("medicine.presets")}</Label>
                    <Input
                      value={s.presets}
                      placeholder={s.dose}
                      onChange={(e) => set("presets", e.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">{t("medicine.presetsHint")}</p>
                  </div>
                  <div className="col-span-2">
                    <Label className="mb-1.5 block">{t("medicine.maxPerIntake")}</Label>
                    <Input
                      inputMode="decimal"
                      className="w-24"
                      value={s.maxPerIntake}
                      onChange={(e) => set("maxPerIntake", e.target.value)}
                    />
                  </div>
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
                <Label className="mb-1.5 block">{t("medicine.form")}</Label>
                <Select value={s.form} onValueChange={(v) => v && set("form", v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => t(`medicine.form_${v}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {FORMS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {t(`medicine.form_${f}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1.5 block">{t("medicine.notes")}</Label>
                <Input value={s.notes} onChange={(e) => set("notes", e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="flex-row gap-2">
          {medicine && !medicine.archivedAt && (
            <Button variant="destructive" onClick={archive}>
              {t("medicine.archive")}
            </Button>
          )}
          <Button className="flex-1" onClick={save}>
            {medicine ? t("common.save") : <><Plus className="size-4" /> {t("medicine.add")}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

