"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { EditDoseDialog } from "@/components/edit-dose-dialog";
import { api } from "@/lib/client";
import { colorClasses, type DoseDTO, type MedicineDTO } from "@/lib/types";
import { formatAmount, formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Range = "3d" | "week" | "month" | "year" | "all";

const RANGE_DAYS: Record<Range, number | null> = {
  "3d": 3,
  week: 7,
  month: 30,
  year: 365,
  all: null,
};

interface TooltipState {
  x: number;
  y: number;
  lines: string[];
}

export function HistoryScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const [range, setRange] = useState<Range>("3d");
  const [medicineFilter, setMedicineFilter] = useState<string>("all");
  const [medicines, setMedicines] = useState<MedicineDTO[]>([]);
  const [doses, setDoses] = useState<DoseDTO[] | null>(null);
  const [editing, setEditing] = useState<DoseDTO | null>(null);

  const reload = useCallback(async () => {
    const days = RANGE_DAYS[range];
    const from = days
      ? new Date(Date.now() - days * 24 * 3_600_000).toISOString()
      : new Date(0).toISOString();
    const [m, d] = await Promise.all([
      api<MedicineDTO[]>("/api/medicines?archived=true"),
      api<DoseDTO[]>(`/api/doses?from=${encodeURIComponent(from)}`),
    ]);
    setMedicines(m);
    setDoses(d);
  }, [range]);

  useEffect(() => {
    reload().catch(() => toast.error(t("common.error")));
  }, [reload, t]);

  const visible = useMemo(
    () =>
      (doses ?? []).filter(
        (d) => medicineFilter === "all" || d.medicineId === medicineFilter,
      ),
    [doses, medicineFilter],
  );
  const medById = useMemo(
    () => new Map(medicines.map((m) => [m.id, m])),
    [medicines],
  );
  const activeMeds = useMemo(() => {
    const ids = new Set(visible.map((d) => d.medicineId));
    return medicines.filter((m) => ids.has(m.id));
  }, [visible, medicines]);

  const selectedMed = medicineFilter === "all" ? null : medById.get(medicineFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("history.title")}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm",
            )}
          >
            <Download className="size-4" /> {t("history.export")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => window.open("/api/export?format=csv")}>
              {t("history.exportCsv")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open("/api/export?format=json")}>
              {t("history.exportJson")}
            </DropdownMenuItem>
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
        <Select
          value={medicineFilter}
          onValueChange={(v) => setMedicineFilter(v ?? "all")}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
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

      {doses === null ? (
        <p className="py-12 text-center text-muted-foreground">{t("common.loading")}</p>
      ) : visible.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {t("history.empty")}
        </Card>
      ) : (
        <>
          {(range === "3d" || range === "week") && (
            <TimelineChart
              days={RANGE_DAYS[range]!}
              doses={visible}
              medicines={activeMeds}
              locale={locale}
              onSelect={setEditing}
            />
          )}
          {(range === "month" || range === "year" || range === "all") && (
            <AggregateBars
              range={range}
              doses={visible}
              medicines={activeMeds}
              locale={locale}
              unitLabel={
                selectedMed ? selectedMed.unit : t("history.doseList").toLowerCase()
              }
              byAmount={!!selectedMed}
            />
          )}

          {activeMeds.length >= 2 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {activeMeds.map((m) => (
                <span key={m.id} className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: (colorClasses[m.color] ?? colorClasses.blue).chart }}
                  />
                  {m.name}
                </span>
              ))}
            </div>
          )}

          <DoseList
            doses={visible}
            medById={medById}
            locale={locale}
            onSelect={setEditing}
          />
        </>
      )}

      <EditDoseDialog
        dose={editing}
        medicine={editing ? medById.get(editing.medicineId) ?? null : null}
        onClose={() => setEditing(null)}
        onChanged={() => {
          setEditing(null);
          void reload();
        }}
      />
    </div>
  );
}

/* ---------- timeline (3 days / week): one lane per medicine, dot per dose ---------- */

function TimelineChart({
  days,
  doses,
  medicines,
  locale,
  onSelect,
}: {
  days: number;
  doses: DoseDTO[];
  medicines: MedicineDTO[];
  locale: string;
  onSelect: (d: DoseDTO) => void;
}) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const W = 640;
  const LANE_H = 44;
  const AXIS_H = 24;
  const H = medicines.length * LANE_H + AXIS_H;
  const now = Date.now();
  const start = now - days * 24 * 3_600_000;
  const x = (time: number) => ((time - start) / (now - start)) * W;

  // Day boundaries for grid lines.
  const dayMarks: Date[] = [];
  const d0 = new Date(start);
  d0.setHours(0, 0, 0, 0);
  for (let d = new Date(d0); d.getTime() <= now; d.setDate(d.getDate() + 1)) {
    if (d.getTime() >= start) dayMarks.push(new Date(d));
  }

  const laneMax = new Map(
    medicines.map((m) => [
      m.id,
      Math.max(...doses.filter((d) => d.medicineId === m.id).map((d) => d.amount), 1),
    ]),
  );

  return (
    <Card className="relative gap-0 overflow-x-auto p-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ minWidth: 320 }}
        role="img"
      >
        {dayMarks.map((d) => (
          <g key={d.getTime()}>
            <line
              x1={x(d.getTime())}
              x2={x(d.getTime())}
              y1={0}
              y2={H - AXIS_H}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={x(d.getTime()) + 4}
              y={H - 8}
              className="fill-muted-foreground"
              fontSize={11}
            >
              {formatDay(d, locale)}
            </text>
          </g>
        ))}
        {medicines.map((m, i) => {
          const color = (colorClasses[m.color] ?? colorClasses.blue).chart;
          const cy = i * LANE_H + LANE_H / 2;
          return (
            <g key={m.id}>
              <line
                x1={0}
                x2={W}
                y1={cy}
                y2={cy}
                className="stroke-border"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
              {doses
                .filter(
                  (d) =>
                    d.medicineId === m.id &&
                    d.status !== "skipped" &&
                    new Date(d.takenAt).getTime() >= start,
                )
                .map((d) => {
                  const time = new Date(d.takenAt);
                  const r = 5 + (d.amount / laneMax.get(m.id)!) * 4;
                  return (
                    <circle
                      key={d.id}
                      cx={x(time.getTime())}
                      cy={cy}
                      r={r}
                      fill={color}
                      opacity={d.status === "uncertain" ? 0.45 : 1}
                      className="cursor-pointer stroke-background"
                      strokeWidth={2}
                      onClick={() => onSelect(d)}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.closest("svg")!.getBoundingClientRect();
                        setTip({
                          x: ((x(time.getTime()) / W) * rect.width),
                          y: (cy / H) * rect.height,
                          lines: [
                            `${m.name} · ${formatAmount(d.amount)} ${m.unit}`,
                            `${formatDay(time, locale)} ${formatTime(time, locale)}`,
                          ],
                        });
                      }}
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

/* ---------- aggregate bars (month / year / all) ---------- */

function AggregateBars({
  range,
  doses,
  medicines,
  locale,
  unitLabel,
  byAmount,
}: {
  range: "month" | "year" | "all";
  doses: DoseDTO[];
  medicines: MedicineDTO[];
  locale: string;
  unitLabel: string;
  /** Single medicine selected → sum amounts; otherwise count doses. */
  byAmount: boolean;
}) {
  const t = useTranslations();
  const [tip, setTip] = useState<TooltipState | null>(null);

  // Bucket by day (month view) or by month (year/all).
  const byDay = range === "month";
  const buckets = useMemo(() => {
    const map = new Map<string, { label: string; date: Date; perMed: Map<string, number> }>();
    const counted = doses.filter((d) => d.status !== "skipped");
    const keyOf = (dt: Date) =>
      byDay
        ? `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`
        : `${dt.getFullYear()}-${dt.getMonth()}`;

    // Seed the full window so empty days/months still show.
    const first = counted.length
      ? new Date(Math.min(...counted.map((d) => new Date(d.takenAt).getTime())))
      : new Date();
    const start = byDay
      ? new Date(Date.now() - 29 * 24 * 3_600_000)
      : range === "year"
        ? new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1)
        : new Date(first.getFullYear(), first.getMonth(), 1);
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    if (!byDay) cursor.setDate(1);
    while (cursor.getTime() <= Date.now()) {
      const label = byDay
        ? String(cursor.getDate())
        : new Intl.DateTimeFormat(locale === "nb" ? "nb-NO" : "en-GB", {
            month: "short",
            ...(range === "all" ? { year: "2-digit" } : {}),
          }).format(cursor);
      map.set(keyOf(cursor), { label, date: new Date(cursor), perMed: new Map() });
      if (byDay) cursor.setDate(cursor.getDate() + 1);
      else cursor.setMonth(cursor.getMonth() + 1);
    }
    for (const d of counted) {
      const b = map.get(keyOf(new Date(d.takenAt)));
      if (!b) continue;
      const v = byAmount ? d.amount : 1;
      b.perMed.set(d.medicineId, (b.perMed.get(d.medicineId) ?? 0) + v);
    }
    return [...map.values()];
  }, [doses, byDay, byAmount, range, locale]);

  const W = 640;
  const H = 180;
  const AXIS_H = 20;
  const maxTotal = Math.max(
    ...buckets.map((b) => [...b.perMed.values()].reduce((s, v) => s + v, 0)),
    1,
  );
  const bw = Math.min(24, (W / buckets.length) * 0.7);
  const step = W / buckets.length;
  const y = (v: number) => (H - AXIS_H) * (1 - v / maxTotal);

  return (
    <Card className="relative gap-1 overflow-x-auto p-3">
      <p className="px-1 text-xs text-muted-foreground">
        {t("history.dailyTotals")} · {unitLabel}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }} role="img">
        <line
          x1={0}
          x2={W}
          y1={H - AXIS_H}
          y2={H - AXIS_H}
          className="stroke-border"
          strokeWidth={1}
        />
        {buckets.map((b, i) => {
          let acc = 0;
          const cx = i * step + step / 2;
          const total = [...b.perMed.values()].reduce((s, v) => s + v, 0);
          return (
            <g
              key={i}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.closest("svg")!.getBoundingClientRect();
                setTip({
                  x: (cx / W) * rect.width,
                  y: (y(total) / H) * rect.height,
                  lines: [
                    formatDay(b.date, locale),
                    ...medicines
                      .filter((m) => b.perMed.get(m.id))
                      .map(
                        (m) => `${m.name}: ${formatAmount(b.perMed.get(m.id)!)}`,
                      ),
                  ],
                });
              }}
              onMouseLeave={() => setTip(null)}
            >
              {/* invisible full-height hit target */}
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
                <text
                  x={cx}
                  y={H - 5}
                  textAnchor="middle"
                  fontSize={10}
                  className="fill-muted-foreground"
                >
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

/* ---------- dose list ---------- */

function DoseList({
  doses,
  medById,
  locale,
  onSelect,
}: {
  doses: DoseDTO[];
  medById: Map<string, MedicineDTO>;
  locale: string;
  onSelect: (d: DoseDTO) => void;
}) {
  const t = useTranslations();
  const shown = doses.slice(0, 100);
  return (
    <Card className="gap-0 p-0">
      <h2 className="border-b px-4 py-2.5 text-sm font-medium text-muted-foreground">
        {t("history.doseList")}
      </h2>
      <ul className="divide-y">
        {shown.map((d) => {
          const m = medById.get(d.medicineId);
          const time = new Date(d.takenAt);
          const colors = colorClasses[m?.color ?? "blue"] ?? colorClasses.blue;
          return (
            <li key={d.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50"
                onClick={() => onSelect(d)}
              >
                <span className={cn("size-2.5 shrink-0 rounded-full", colors.dot)} />
                <span className="flex-1">
                  <span className="font-medium">
                    {formatAmount(d.amount)} {m?.unit} {m?.name}
                  </span>
                  {d.status !== "taken" && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {d.status === "uncertain"
                        ? t("history.uncertain")
                        : t("history.skipped")}
                    </span>
                  )}
                  {d.note && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {d.note}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {formatDay(time, locale)} {formatTime(time, locale)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
