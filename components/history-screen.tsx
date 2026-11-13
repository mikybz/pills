"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EarlierDoseButton } from "@/components/earlier-dose";
import { EditDoseDialog } from "@/components/edit-dose-dialog";
import { LogSheet } from "@/components/log-sheet";
import { usePersons } from "@/components/person-context";
import { useDoseLogger } from "@/components/use-dose-logger";
import { api } from "@/lib/client";
import { formatAmount, formatDay, formatDose, formatDuration, formatMonth, formatTime } from "@/lib/format";
import { DAY, historySlots, isScheduled, MIN, type HistorySlot, type LogEntry } from "@/lib/schedule";
import { addDays, localDate, startOfLocalDay, weekdayMon0 } from "@/lib/tz";
import {
  colorClasses,
  doseAmountOf,
  personDayOf,
  segmentsOf,
  toLogEntries,
  type DoseDTO,
  type MedicineDTO,
  type ProfileDTO,
} from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

type Range = "3d" | "week" | "month" | "year" | "all";
const RANGE_DAYS: Record<Range, number | null> = { "3d": 3, week: 7, month: 30, year: 365, all: null };
const LATE_SHOWN_MS = 30 * MIN;

interface TooltipState {
  x: number;
  y: number;
  lines: string[];
}

interface Data {
  key: string;
  profile: ProfileDTO;
  medicines: MedicineDTO[];
  doses: DoseDTO[];
}

/** A missed slot (derived) with its medicine. */
interface MissedItem {
  medicineId: string;
  slot: HistorySlot;
}

export function HistoryScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const { current, meId } = usePersons();
  const personId = current?.id;
  const person = useMemo(() => personDayOf(current), [current]);
  const tz = person.timezone;
  const now = useNow();
  const [range, setRange] = useState<Range>("week");
  const [medicineFilter, setMedicineFilter] = useState<string>("all");
  const [prevPersonId, setPrevPersonId] = useState(personId);
  if (prevPersonId !== personId) {
    setPrevPersonId(personId);
    setMedicineFilter("all");
  }
  const [data, setData] = useState<Data | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const [editing, setEditing] = useState<DoseDTO | null>(null);
  const [sheet, setSheet] = useState<{ medicine: MedicineDTO; slotAt?: number; initialAt: number } | null>(null);

  const key = `${personId}|${range}`;
  useEffect(() => {
    if (!personId) return;
    let alive = true;
    const days = RANGE_DAYS[range];
    // One extra day back: the push rule and slot windows look at the previous dose.
    const from = days ? new Date(Date.now() - (days + 1) * DAY).toISOString() : new Date(0).toISOString();
    const pid = encodeURIComponent(personId);
    Promise.all([
      api<ProfileDTO>("/api/profile"),
      api<MedicineDTO[]>(`/api/medicines?personId=${pid}&archived=true&versions=true`),
      api<DoseDTO[]>(`/api/doses?personId=${pid}&from=${encodeURIComponent(from)}`),
    ])
      .then(([profile, medicines, doses]) => alive && setData({ key: `${personId}|${range}`, profile, medicines, doses }))
      .catch(() => toast.error(t("common.error")));
    return () => {
      alive = false;
    };
  }, [personId, range, version, t]);

  const ready = data && data.key === key ? data : null;
  const medicines = useMemo(() => ready?.medicines ?? [], [ready]);
  const medById = useMemo(() => new Map(medicines.map((m) => [m.id, m])), [medicines]);
  const logsByMed = useMemo(() => {
    const map = new Map<string, LogEntry[]>();
    for (const m of medicines) map.set(m.id, toLogEntries((ready?.doses ?? []).filter((d) => d.medicineId === m.id), m));
    return map;
  }, [medicines, ready]);
  const logsFor = useCallback((id: string) => logsByMed.get(id) ?? [], [logsByMed]);

  const today = localDate(now, tz);
  const days = RANGE_DAYS[range];
  const rangeStart = useMemo(() => {
    if (days) return startOfLocalDay(addDays(today, -(days - 1)), tz);
    const firsts = [
      ...(ready?.doses ?? []).map((d) => Date.parse(d.takenAt)),
      ...medicines.map((m) => (m.scheduleReviewedAt ? Date.parse(m.scheduleReviewedAt) : Infinity)),
    ];
    const first = Math.min(...firsts, now);
    return startOfLocalDay(localDate(first, tz), tz);
  }, [days, today, tz, ready, medicines, now]);

  const filtered = useMemo(
    () => medicines.filter((m) => medicineFilter === "all" || m.id === medicineFilter),
    [medicines, medicineFilter],
  );

  // Derived slots per medicine (same pure function as the home screen).
  const slotsByMed = useMemo(() => {
    const map = new Map<string, HistorySlot[]>();
    for (const m of filtered) {
      const slots = historySlots(segmentsOf(m, person, now), logsFor(m.id), rangeStart, now, now);
      if (slots.length) map.set(m.id, slots);
    }
    return map;
  }, [filtered, person, now, logsFor, rangeStart]);

  const visibleDoses = useMemo(
    () =>
      (ready?.doses ?? []).filter(
        (d) => filtered.some((m) => m.id === d.medicineId) && Date.parse(d.takenAt) >= rangeStart,
      ),
    [ready, filtered, rangeStart],
  );

  const missed: MissedItem[] = useMemo(
    () =>
      [...slotsByMed].flatMap(([medicineId, slots]) =>
        slots.filter((s) => s.state === "missed").map((slot) => ({ medicineId, slot })),
      ),
    [slotsByMed],
  );

  /** Lateness of a taken dose against its (effective) slot time. */
  const lateByDose = useMemo(() => {
    const map = new Map<string, number>();
    for (const slots of slotsByMed.values()) {
      for (const s of slots) {
        if (s.log?.id && s.state === "taken") map.set(s.log.id, s.log.takenAt - s.effectiveAt);
      }
    }
    return map;
  }, [slotsByMed]);

  const summary = useMemo(() => {
    let taken = 0;
    let missedN = 0;
    let skipped = 0;
    for (const slots of slotsByMed.values()) {
      for (const s of slots) {
        if (s.state === "taken") taken++;
        else if (s.state === "missed") missedN++;
        else if (s.state === "skipped") skipped++;
      }
    }
    return { taken, missed: missedN, skipped, total: taken + missedN + skipped };
  }, [slotsByMed]);

  const { requestLog, dialog, slotFor } = useDoseLogger({
    profile: ready?.profile ?? null,
    person,
    logsFor,
    onLogged: reload,
    onUndone: reload,
  });

  const laneMeds = useMemo(
    () => filtered.filter((m) => slotsByMed.has(m.id) || visibleDoses.some((d) => d.medicineId === m.id)),
    [filtered, slotsByMed, visibleDoses],
  );
  const hasScheduledView = slotsByMed.size > 0;
  const asNeededMeds = laneMeds.filter((m) => !isScheduled(m.mode));
  const selectedMed = medicineFilter === "all" ? null : medById.get(medicineFilter);
  const exportUrl = (format: string) => `/api/export?format=${format}&personId=${encodeURIComponent(personId ?? "")}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("history.title")}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm">
            <Download className="size-4" /> {t("history.export")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => window.open(exportUrl("csv"))}>{t("history.exportCsv")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open(exportUrl("json"))}>{t("history.exportJson")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
        <TabsList className="w-full">
          <TabsTrigger value="3d">{t("history.range3d")}</TabsTrigger>
          <TabsTrigger value="week">{t("history.rangeWeek")}</TabsTrigger>
          <TabsTrigger value="month">{t("history.rangeMonth")}</TabsTrigger>
          <TabsTrigger value="year">{t("history.rangeYear")}</TabsTrigger>
          <TabsTrigger value="all">{t("history.rangeAll")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {medicines.length > 1 && (
        <Select value={medicineFilter} onValueChange={(v) => setMedicineFilter(v ?? "all")}>
          <SelectTrigger className="w-full">
            <SelectValue>
              {(v: string) => (v === "all" ? t("history.allMedicines") : (medById.get(v)?.name ?? ""))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("history.allMedicines")}</SelectItem>
            {medicines.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {!ready ? (
        <p className="py-12 text-center text-muted-foreground">{t("common.loading")}</p>
      ) : visibleDoses.length === 0 && slotsByMed.size === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{t("history.empty")}</Card>
      ) : (
        <>
          {summary.total > 0 && (
            <p className="text-sm">
              <span className="text-muted-foreground">{t(`history.summary_${range}`)}: </span>
              <span className="font-medium">{t("history.summaryTaken", { taken: summary.taken, total: summary.total })}</span>
              {summary.missed > 0 && (
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  {" · "}
                  {t("history.summaryMissed", { count: summary.missed })}
                </span>
              )}
              {summary.skipped > 0 && <> · {t("history.summarySkipped", { count: summary.skipped })}</>}
            </p>
          )}

          {(range === "3d" || range === "week") && (
            <TimelineChart
              start={rangeStart}
              now={now}
              tz={tz}
              doses={visibleDoses}
              missed={missed}
              medicines={laneMeds}
              locale={locale}
              onSelect={setEditing}
            />
          )}
          {range === "month" &&
            (hasScheduledView ? (
              <MonthCalendar start={rangeStart} today={today} tz={tz} slotsByMed={slotsByMed} locale={locale} />
            ) : (
              <AggregateBars
                byDay
                start={rangeStart}
                now={now}
                tz={tz}
                doses={visibleDoses}
                medicines={laneMeds}
                locale={locale}
                unitLabel={selectedMed ? selectedMed.unit : t("history.doses")}
                byAmount={!!selectedMed}
              />
            ))}
          {(range === "year" || range === "all") && (
            <>
              {hasScheduledView && (
                <AdherenceBars start={rangeStart} now={now} tz={tz} slotsByMed={slotsByMed} locale={locale} withYear={range === "all"} />
              )}
              {asNeededMeds.length > 0 && (
                <AggregateBars
                  byDay={false}
                  start={rangeStart}
                  now={now}
                  tz={tz}
                  doses={visibleDoses.filter((d) => asNeededMeds.some((m) => m.id === d.medicineId))}
                  medicines={asNeededMeds}
                  locale={locale}
                  withYear={range === "all"}
                  unitLabel={selectedMed ? selectedMed.unit : t("history.doses")}
                  byAmount={!!selectedMed}
                />
              )}
            </>
          )}

          {laneMeds.length >= 2 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {laneMeds.map((m) => (
                <span key={m.id} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full" style={{ background: (colorClasses[m.color] ?? colorClasses.blue).chart }} />
                  {m.name}
                </span>
              ))}
              {missed.length > 0 && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2.5 rounded-full border-2 border-muted-foreground" /> {t("history.missedLegend")}
                </span>
              )}
            </div>
          )}

          <EarlierDoseButton
            medicines={medicines.filter((m) => !m.archivedAt)}
            onPick={(m) => setSheet({ medicine: m, initialAt: Date.now() })}
          />

          <DayList
            doses={visibleDoses}
            missed={missed}
            slotsByMed={slotsByMed}
            medById={medById}
            lateByDose={lateByDose}
            tz={tz}
            locale={locale}
            meId={meId}
            onEdit={setEditing}
            onTookIt={(m, slotAt) => setSheet({ medicine: m, slotAt, initialAt: slotAt })}
            onSkip={(m, slotAt) => requestLog(m, { amount: doseAmountOf(m), takenAt: slotAt, status: "skipped", slotAt })}
          />
        </>
      )}

      {editing && (
        <EditDoseDialog
          dose={editing}
          medicine={medById.get(editing.medicineId) ?? null}
          timeZone={tz}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {sheet && (
        <LogSheet
          medicine={sheet.medicine}
          timeZone={tz}
          slotAt={sheet.slotAt}
          initialAt={sheet.initialAt}
          countsAs={(at, n) => slotFor(sheet.medicine, at, sheet.slotAt, n)}
          onClose={() => setSheet(null)}
          onSubmit={(req) => {
            const m = sheet.medicine;
            setSheet(null);
            requestLog(m, req);
          }}
        />
      )}
      {dialog}
    </div>
  );
}

/* ---------- day list: grouped by local day, newest first, logs + missed slots ---------- */

type DayRow =
  | { kind: "dose"; at: number; dose: DoseDTO }
  | { kind: "missed"; at: number; item: MissedItem };

function DayList({
  doses,
  missed,
  slotsByMed,
  medById,
  lateByDose,
  tz,
  locale,
  meId,
  onEdit,
  onTookIt,
  onSkip,
}: {
  doses: DoseDTO[];
  missed: MissedItem[];
  slotsByMed: Map<string, HistorySlot[]>;
  medById: Map<string, MedicineDTO>;
  lateByDose: Map<string, number>;
  tz: string;
  locale: string;
  meId: string | null;
  onEdit: (d: DoseDTO) => void;
  onTookIt: (m: MedicineDTO, slotAt: number) => void;
  onSkip: (m: MedicineDTO, slotAt: number) => void;
}) {
  const t = useTranslations();
  const days = useMemo(() => {
    const map = new Map<string, DayRow[]>();
    const add = (day: string, row: DayRow) => map.set(day, [...(map.get(day) ?? []), row]);
    for (const d of doses) {
      const at = Date.parse(d.takenAt);
      add(localDate(at, tz), { kind: "dose", at, dose: d });
    }
    for (const item of missed) add(localDate(item.slot.slotAt, tz), { kind: "missed", at: item.slot.slotAt, item });
    // Per-day scheduled tally ("5 of 6 taken"), by the day of the slot.
    const tally = new Map<string, { taken: number; total: number }>();
    for (const slots of slotsByMed.values()) {
      for (const s of slots) {
        if (s.state !== "taken" && s.state !== "missed" && s.state !== "skipped") continue;
        const day = localDate(s.slotAt, tz);
        const c = tally.get(day) ?? { taken: 0, total: 0 };
        c.total++;
        if (s.state === "taken") c.taken++;
        tally.set(day, c);
      }
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, rows]) => ({ day, rows: rows.sort((a, b) => a.at - b.at), tally: tally.get(day) }));
  }, [doses, missed, slotsByMed, tz]);

  return (
    <div className="space-y-3">
      {days.map(({ day, rows, tally }) => (
        <Card key={day} id={`day-${day}`} className="scroll-mt-20 gap-0 p-0">
          <h2 className="flex items-center justify-between border-b px-4 py-2 text-sm font-medium">
            <span>{formatDay(startOfLocalDay(day, tz) + 12 * 3_600_000, locale, tz)}</span>
            {tally && (
              <span className={cn("text-xs", tally.taken < tally.total ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                {t("history.summaryTaken", { taken: tally.taken, total: tally.total })}
              </span>
            )}
          </h2>
          <ul className="divide-y">
            {rows.map((row) => {
              if (row.kind === "missed") {
                const m = medById.get(row.item.medicineId)!;
                return (
                  <li key={`m:${m.id}:${row.at}`}>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50">
                        <span className="w-11 shrink-0 text-sm tabular-nums text-muted-foreground">{formatTime(row.at, locale, tz)}</span>
                        <span
                          className="size-2.5 shrink-0 rounded-full border-2"
                          style={{ borderColor: (colorClasses[m.color] ?? colorClasses.blue).chart }}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {m.name} <span className="text-muted-foreground">{formatDose(doseAmountOf(m), m.unit, t)}</span>
                        </span>
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                          {t("history.missedBadge")}
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onTookIt(m, row.at)}>{t("history.iTookIt")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onSkip(m, row.at)}>{t("history.markSkipped")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              }
              const d = row.dose;
              const m = medById.get(d.medicineId);
              const colors = colorClasses[m?.color ?? "blue"] ?? colorClasses.blue;
              const late = lateByDose.get(d.id) ?? 0;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50"
                    onClick={() => onEdit(d)}
                  >
                    <span className="w-11 shrink-0 text-sm tabular-nums">{formatTime(row.at, locale, tz)}</span>
                    <span className={cn("size-2.5 shrink-0 rounded-full", colors.dot, d.status === "uncertain" && "opacity-45")} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate", d.status === "skipped" && "text-muted-foreground")}>
                        {m?.name} <span className="text-muted-foreground">{m ? formatDose(d.amount, m.unit, t) : formatAmount(d.amount)}</span>
                      </span>
                      {d.note && <span className="block truncate text-xs text-muted-foreground">{d.note}</span>}
                      {d.loggedBy && meId && d.loggedBy.id !== meId && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {t("people.loggedBy", { name: d.loggedBy.name ?? d.loggedBy.email })}
                        </span>
                      )}
                    </span>
                    {d.status !== "taken" && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {d.status === "uncertain" ? t("history.uncertain") : t("history.skipped")}
                      </span>
                    )}
                    {d.status === "taken" && late > LATE_SHOWN_MS && (
                      <span className="text-xs text-muted-foreground">{t("home.late", { duration: formatDuration(late, t) })}</span>
                    )}
                    {d.status === "taken" && m && !isScheduled(m.mode) && (
                      <span className="text-xs text-muted-foreground">{t("history.asNeededBadge")}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/* ---------- timeline (3 days / week): one lane per medicine ---------- */

function TimelineChart({
  start,
  now,
  tz,
  doses,
  missed,
  medicines,
  locale,
  onSelect,
}: {
  start: number;
  now: number;
  tz: string;
  doses: DoseDTO[];
  missed: MissedItem[];
  medicines: MedicineDTO[];
  locale: string;
  onSelect: (d: DoseDTO) => void;
}) {
  const t = useTranslations();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const W = 640;
  const LANE_H = 44;
  const AXIS_H = 24;
  const H = medicines.length * LANE_H + AXIS_H;
  const x = (time: number) => ((time - start) / (now - start)) * W;

  const dayMarks: number[] = [];
  for (let d = localDate(start, tz); startOfLocalDay(d, tz) <= now; d = addDays(d, 1)) dayMarks.push(startOfLocalDay(d, tz));

  const laneMax = new Map(
    medicines.map((m) => [m.id, Math.max(...doses.filter((d) => d.medicineId === m.id).map((d) => d.amount), 1)]),
  );
  const hover = (e: React.MouseEvent<SVGElement>, cx: number, cy: number, lines: string[]) => {
    const rect = e.currentTarget.closest("svg")!.getBoundingClientRect();
    setTip({ x: (cx / W) * rect.width, y: (cy / H) * rect.height, lines });
  };

  return (
    <Card className="relative gap-0 overflow-x-auto p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }} role="img">
        {dayMarks.map((d) => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={0} y2={H - AXIS_H} className="stroke-border" strokeWidth={1} />
            <text x={x(d) + 4} y={H - 8} className="fill-muted-foreground" fontSize={11}>
              {formatDay(d, locale, tz)}
            </text>
          </g>
        ))}
        {medicines.map((m, i) => {
          const color = (colorClasses[m.color] ?? colorClasses.blue).chart;
          const cy = i * LANE_H + LANE_H / 2;
          return (
            <g key={m.id}>
              <line x1={0} x2={W} y1={cy} y2={cy} className="stroke-border" strokeWidth={1} strokeDasharray="2 4" />
              {missed
                .filter((it) => it.medicineId === m.id && it.slot.slotAt >= start)
                .map((it) => {
                  const cx = x(it.slot.slotAt);
                  return (
                    <circle
                      key={`miss-${it.slot.slotAt}`}
                      cx={cx}
                      cy={cy}
                      r={6}
                      fill="var(--background)"
                      stroke={color}
                      strokeWidth={2.5}
                      onMouseEnter={(e) =>
                        hover(e, cx, cy, [`${m.name} · ${t("history.missedBadge")}`, `${formatDay(it.slot.slotAt, locale, tz)} ${formatTime(it.slot.slotAt, locale, tz)}`])
                      }
                      onMouseLeave={() => setTip(null)}
                    />
                  );
                })}
              {doses
                .filter((d) => d.medicineId === m.id && d.status !== "skipped")
                .map((d) => {
                  const time = Date.parse(d.takenAt);
                  const cx = x(time);
                  return (
                    <circle
                      key={d.id}
                      cx={cx}
                      cy={cy}
                      r={5 + (d.amount / laneMax.get(m.id)!) * 4}
                      fill={color}
                      opacity={d.status === "uncertain" ? 0.45 : 1}
                      className="cursor-pointer stroke-background"
                      strokeWidth={2}
                      onClick={() => onSelect(d)}
                      onMouseEnter={(e) =>
                        hover(e, cx, cy, [`${m.name} · ${formatDose(d.amount, m.unit, t)}`, `${formatDay(time, locale, tz)} ${formatTime(time, locale, tz)}`])
                      }
                      onMouseLeave={() => setTip(null)}
                    />
                  );
                })}
            </g>
          );
        })}
      </svg>
      {tip && <ChartTooltip tip={tip} />}
    </Card>
  );
}

/* ---------- month: calendar grid of complete / partly / nothing taken ---------- */

function MonthCalendar({
  start,
  today,
  tz,
  slotsByMed,
  locale,
}: {
  start: number;
  today: string;
  tz: string;
  slotsByMed: Map<string, HistorySlot[]>;
  locale: string;
}) {
  const t = useTranslations();
  const first = localDate(start, tz);
  const tally = new Map<string, { taken: number; total: number }>();
  for (const slots of slotsByMed.values()) {
    for (const s of slots) {
      if (s.state !== "taken" && s.state !== "missed" && s.state !== "skipped") continue;
      const day = localDate(s.slotAt, tz);
      const c = tally.get(day) ?? { taken: 0, total: 0 };
      c.total++;
      if (s.state === "taken") c.taken++;
      tally.set(day, c);
    }
  }
  const lead = weekdayMon0(first);
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; d <= today; d = addDays(d, 1)) cells.push(d);
  // Weekday headers from a known Monday.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale === "nb" ? "nb-NO" : "en-GB", { weekday: "narrow", timeZone: "UTC" }).format(
      Date.UTC(2024, 0, 1 + i),
    ),
  );

  return (
    <Card className="gap-2 p-3">
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {weekdays.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <span key={`pad-${i}`} />;
          const c = tally.get(day);
          const status = !c ? "none" : c.taken === c.total ? "complete" : c.taken === 0 ? "nothing" : "partly";
          return (
            <button
              key={day}
              type="button"
              disabled={!c}
              onClick={() => document.getElementById(`day-${day}`)?.scrollIntoView({ behavior: "smooth" })}
              title={c ? t("history.summaryTaken", { taken: c.taken, total: c.total }) : undefined}
              className="flex flex-col items-center gap-0.5 rounded-lg py-1 text-xs hover:bg-accent/50 disabled:hover:bg-transparent"
            >
              <span className={cn(day === today && "font-bold")}>{Number(day.slice(8))}</span>
              <DayMarker status={status} />
              <span className="h-3 text-[10px] leading-3 text-muted-foreground">
                {c && status !== "complete" ? `${c.taken}/${c.total}` : ""}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><DayMarker status="complete" /> {t("history.calComplete")}</span>
        <span className="flex items-center gap-1"><DayMarker status="partly" /> {t("history.calPartly")}</span>
        <span className="flex items-center gap-1"><DayMarker status="nothing" /> {t("history.calNothing")}</span>
      </div>
    </Card>
  );
}

/** Shape carries the meaning (filled / half / ring), not only color. */
function DayMarker({ status }: { status: "complete" | "partly" | "nothing" | "none" }) {
  if (status === "none") return <span className="size-4" />;
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      {status === "complete" && (
        <>
          <circle cx={8} cy={8} r={7} className="fill-teal-600" />
          <path d="M4.8 8.3l2.1 2.1 4.3-4.6" fill="none" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === "partly" && (
        <>
          <circle cx={8} cy={8} r={6.25} fill="none" className="stroke-amber-600" strokeWidth={1.5} />
          <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" className="fill-amber-600" />
        </>
      )}
      {status === "nothing" && <circle cx={8} cy={8} r={6.25} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="2 2" />}
    </svg>
  );
}

/* ---------- year / all: share of slots taken per month (scheduled) ---------- */

function monthBuckets(start: number, now: number, tz: string) {
  const out: { key: string; at: number }[] = [];
  let d = `${localDate(start, tz).slice(0, 7)}-01`;
  while (startOfLocalDay(d, tz) <= now) {
    out.push({ key: d.slice(0, 7), at: startOfLocalDay(d, tz) });
    const [y, m] = d.split("-").map(Number);
    d = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }
  return out;
}

function AdherenceBars({
  start,
  now,
  tz,
  slotsByMed,
  locale,
  withYear,
}: {
  start: number;
  now: number;
  tz: string;
  slotsByMed: Map<string, HistorySlot[]>;
  locale: string;
  withYear: boolean;
}) {
  const t = useTranslations();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const buckets = monthBuckets(start, now, tz).map((b) => ({ ...b, taken: 0, total: 0 }));
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const slots of slotsByMed.values()) {
    for (const s of slots) {
      if (s.state !== "taken" && s.state !== "missed" && s.state !== "skipped") continue;
      const b = byKey.get(localDate(s.slotAt, tz).slice(0, 7));
      if (!b) continue;
      b.total++;
      if (s.state === "taken") b.taken++;
    }
  }
  const W = 640;
  const H = 160;
  const AXIS_H = 20;
  const step = W / Math.max(1, buckets.length);
  const bw = Math.min(28, step * 0.7);
  const y = (share: number) => (H - AXIS_H) * (1 - share);

  return (
    <Card className="relative gap-1 overflow-x-auto p-3">
      <p className="px-1 text-xs text-muted-foreground">{t("history.adherence")}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }} role="img">
        {[0.5, 1].map((g) => (
          <g key={g}>
            <line x1={0} x2={W} y1={y(g)} y2={y(g)} className="stroke-border" strokeDasharray="2 4" />
            <text x={W - 2} y={y(g) - 3} textAnchor="end" fontSize={10} className="fill-muted-foreground">
              {g * 100}%
            </text>
          </g>
        ))}
        <line x1={0} x2={W} y1={H - AXIS_H} y2={H - AXIS_H} className="stroke-border" />
        {buckets.map((b, i) => {
          const cx = i * step + step / 2;
          const share = b.total ? b.taken / b.total : 0;
          return (
            <g
              key={b.key}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.closest("svg")!.getBoundingClientRect();
                setTip({
                  x: (cx / W) * rect.width,
                  y: (y(share) / H) * rect.height,
                  lines: [formatMonth(b.at, locale, true, tz), b.total ? t("history.summaryTaken", { taken: b.taken, total: b.total }) : "—"],
                });
              }}
              onMouseLeave={() => setTip(null)}
            >
              <rect x={i * step} y={0} width={step} height={H - AXIS_H} fill="transparent" />
              {b.total > 0 && (
                <rect x={cx - bw / 2} y={y(share)} width={bw} height={Math.max(2, H - AXIS_H - y(share))} rx={2} className="fill-teal-600" />
              )}
              {(buckets.length <= 12 || i % Math.ceil(buckets.length / 12) === 0) && (
                <text x={cx} y={H - 5} textAnchor="middle" fontSize={10} className="fill-muted-foreground">
                  {formatMonth(b.at, locale, withYear, tz)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tip && <ChartTooltip tip={tip} />}
    </Card>
  );
}

/* ---------- as-needed count / amount bars (month: per day; year / all: per month) ---------- */

function AggregateBars({
  byDay,
  start,
  now,
  tz,
  doses,
  medicines,
  locale,
  unitLabel,
  byAmount,
  withYear = false,
}: {
  byDay: boolean;
  start: number;
  now: number;
  tz: string;
  doses: DoseDTO[];
  medicines: MedicineDTO[];
  locale: string;
  unitLabel: string;
  /** Single medicine selected → sum amounts; otherwise count doses. */
  byAmount: boolean;
  withYear?: boolean;
}) {
  const t = useTranslations();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const buckets = useMemo(() => {
    const list: { key: string; label: string; at: number; perMed: Map<string, number> }[] = [];
    if (byDay) {
      for (let d = localDate(start, tz); startOfLocalDay(d, tz) <= now; d = addDays(d, 1)) {
        list.push({ key: d, label: String(Number(d.slice(8))), at: startOfLocalDay(d, tz), perMed: new Map() });
      }
    } else {
      for (const b of monthBuckets(start, now, tz)) {
        list.push({ key: b.key, label: formatMonth(b.at, locale, withYear, tz), at: b.at, perMed: new Map() });
      }
    }
    const map = new Map(list.map((b) => [b.key, b]));
    for (const d of doses) {
      if (d.status === "skipped") continue;
      const day = localDate(Date.parse(d.takenAt), tz);
      const b = map.get(byDay ? day : day.slice(0, 7));
      if (!b) continue;
      b.perMed.set(d.medicineId, (b.perMed.get(d.medicineId) ?? 0) + (byAmount ? d.amount : 1));
    }
    return list;
  }, [byDay, start, now, tz, doses, byAmount, locale, withYear]);

  const W = 640;
  const H = 180;
  const AXIS_H = 20;
  const maxTotal = Math.max(...buckets.map((b) => [...b.perMed.values()].reduce((s, v) => s + v, 0)), 1);
  const step = W / Math.max(1, buckets.length);
  const bw = Math.min(24, step * 0.7);
  const y = (v: number) => (H - AXIS_H) * (1 - v / maxTotal);

  return (
    <Card className="relative gap-1 overflow-x-auto p-3">
      <p className="px-1 text-xs text-muted-foreground">
        {t(byDay ? "history.dailyTotals" : "history.monthlyTotals")} · {unitLabel}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }} role="img">
        <line x1={0} x2={W} y1={H - AXIS_H} y2={H - AXIS_H} className="stroke-border" strokeWidth={1} />
        {buckets.map((b, i) => {
          let acc = 0;
          const cx = i * step + step / 2;
          const total = [...b.perMed.values()].reduce((s, v) => s + v, 0);
          return (
            <g
              key={b.key}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.closest("svg")!.getBoundingClientRect();
                setTip({
                  x: (cx / W) * rect.width,
                  y: (y(total) / H) * rect.height,
                  lines: [
                    byDay ? formatDay(b.at, locale, tz) : formatMonth(b.at, locale, true, tz),
                    ...medicines.filter((m) => b.perMed.get(m.id)).map((m) => `${m.name}: ${formatAmount(b.perMed.get(m.id)!)}`),
                  ],
                });
              }}
              onMouseLeave={() => setTip(null)}
            >
              <rect x={i * step} y={0} width={step} height={H - AXIS_H} fill="transparent" />
              {medicines.map((m) => {
                const v = b.perMed.get(m.id);
                if (!v) return null;
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                return (
                  <rect
                    key={m.id}
                    x={cx - bw / 2}
                    y={y1}
                    width={bw}
                    height={Math.max(2, y0 - y1 - 1)}
                    rx={2}
                    fill={(colorClasses[m.color] ?? colorClasses.blue).chart}
                  />
                );
              })}
              {(buckets.length <= 12 || i % Math.ceil(buckets.length / 12) === 0) && (
                <text x={cx} y={H - 5} textAnchor="middle" fontSize={10} className="fill-muted-foreground">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tip && <ChartTooltip tip={tip} />}
    </Card>
  );
}

function ChartTooltip({ tip }: { tip: TooltipState }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
      style={{ left: tip.x + 12, top: tip.y + 4 }}
    >
      {tip.lines.map((l, i) => (
        <div key={i} className={i === 0 ? "font-medium" : "text-muted-foreground"}>
          {l}
        </div>
      ))}
    </div>
  );
}
