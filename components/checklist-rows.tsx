"use client";

import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, Check, Ellipsis, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CareStatus } from "@/lib/care";
import { formatDaysAgo, formatDose, formatDuration, formatLocalDate, formatTime } from "@/lib/format";
import type { LogEntry, Slot } from "@/lib/schedule";
import { colorClasses, doseAmountOf, kindOf, verbKind, type MedicineDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Messages pick their verb by kind and form: Apply (creams), Done (tasks), Log (measurements), Take. */
const verbForm = (m: Pick<MedicineDTO, "form" | "kind">) => verbKind(m);

/** The amount line of a row: a dose ("1 tablet"); nothing for tasks and measurements. */
function amountOf(m: MedicineDTO, t: ReturnType<typeof useTranslations>) {
  return kindOf(m) === "medicine" ? formatDose(doseAmountOf(m), m.unit, t) : null;
}

/** A logged amount: the dose, the reading ("31.4 kg"), or "done" for a task. */
export function loggedAmount(m: MedicineDTO, amount: number, t: ReturnType<typeof useTranslations>) {
  return kindOf(m) === "task" ? t("care.doneWord") : formatDose(amount, m.unit, t);
}

export function Section({ title, children, tone }: { title: string; children: React.ReactNode; tone?: "alert" }) {
  return (
    <section className="space-y-1.5">
      <h2
        className={cn(
          "px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
          tone === "alert" && "text-amber-700 dark:text-amber-400",
        )}
      >
        {title}
      </h2>
      <Card className="gap-0 p-0">
        <ul className="divide-y">{children}</ul>
      </Card>
    </section>
  );
}

/** Slot time; a pushed slot shows its effective time with the original struck through. */
function SlotTime({ slot, timeZone }: { slot: Slot; timeZone: string }) {
  const locale = useLocale();
  const pushed = slot.effectiveAt !== slot.slotAt;
  return (
    <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">
      {formatTime(slot.effectiveAt, locale, timeZone)}
      {pushed && (
        <s className="block text-xs font-normal text-muted-foreground">
          {formatTime(slot.slotAt, locale, timeZone)}
        </s>
      )}
    </span>
  );
}

/** Why a slot's time moved: "Moved 1 h because the last dose was late". */
function MovedReason({ slot }: { slot: Slot }) {
  const t = useTranslations();
  if (!slot.moved) return null;
  return (
    <span className="block text-xs text-muted-foreground">
      {slot.moved === "late"
        ? t("home.movedLate", { by: formatDuration(slot.effectiveAt - slot.slotAt, t) })
        : t("home.movedNight")}
    </span>
  );
}

function Name({
  medicine,
  sub,
  slot,
}: {
  medicine: MedicineDTO;
  sub?: React.ReactNode;
  /** Shows the reason when the slot's time moved. */
  slot?: Slot;
}) {
  const t = useTranslations();
  const colors = colorClasses[medicine.color] ?? colorClasses.blue;
  const amount = amountOf(medicine, t);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className={cn("h-8 w-1 shrink-0 rounded-full", colors.dot)} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate font-medium">{medicine.name}</span>
        <span className="block text-xs text-muted-foreground">
          {amount}
          {amount && sub && " · "}
          {sub}
        </span>
        {slot && <MovedReason slot={slot} />}
      </span>
    </span>
  );
}

function MoreButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations();
  return (
    <Button variant="ghost" size="icon" aria-label={t("home.more")} onClick={onClick}>
      <Ellipsis className="size-5" />
    </Button>
  );
}

export function DueRow({
  medicine,
  slot,
  timeZone,
  now,
  onTake,
  onMore,
}: {
  medicine: MedicineDTO;
  slot: Slot;
  timeZone: string;
  now: number;
  onTake: () => void;
  onMore: () => void;
}) {
  const t = useTranslations();
  const late = now - slot.effectiveAt;
  return (
    <li className="flex items-center gap-3 py-2.5 pl-4 pr-2">
      <SlotTime slot={slot} timeZone={timeZone} />
      <Name
        medicine={medicine}
        slot={slot}
        sub={
          late >= 60_000 ? (
            <span className="font-medium text-amber-700 dark:text-amber-400">
              {t("home.late", { duration: formatDuration(late, t) })}
            </span>
          ) : slot.state === "due" ? (
            t("home.dueSoon")
          ) : null
        }
      />
      <Button className="h-10 px-4" onClick={onTake}>
        {t("home.take", { form: verbForm(medicine) })}
      </Button>
      <MoreButton onClick={onMore} />
    </li>
  );
}

export function MissedRow({
  medicine,
  slot,
  timeZone,
  onTakeLate,
  onSkip,
  onMore,
}: {
  medicine: MedicineDTO;
  slot: Slot;
  timeZone: string;
  onTakeLate: () => void;
  onSkip: () => void;
  onMore: () => void;
}) {
  const t = useTranslations();
  return (
    <li className="space-y-2 py-2.5 pl-4 pr-2">
      <div className="flex items-center gap-3">
        <SlotTime slot={slot} timeZone={timeZone} />
        <Name medicine={medicine} slot={slot} sub={<span className="font-medium">{t("home.missedBadge")}</span>} />
        <MoreButton onClick={onMore} />
      </div>
      <div className="flex gap-2 pl-15">
        <Button size="sm" variant="outline" onClick={onTakeLate}>
          {t("home.takeLate", { form: verbForm(medicine) })}
        </Button>
        <Button size="sm" variant="ghost" onClick={onSkip}>
          {t("home.skip")}
        </Button>
      </div>
    </li>
  );
}

export function LaterRow({
  medicine,
  slot,
  timeZone,
  onTakeNow,
  onSkip,
  onMore,
}: {
  medicine: MedicineDTO;
  slot: Slot;
  timeZone: string;
  onTakeNow: () => void;
  onSkip: () => void;
  onMore: () => void;
}) {
  const t = useTranslations();
  return (
    <li>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center gap-3 py-2.5 pl-4 pr-4 text-left hover:bg-accent/50">
          <SlotTime slot={slot} timeZone={timeZone} />
          <Name medicine={medicine} slot={slot} />
          <Ellipsis className="size-5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={onTakeNow}>{t("home.takeNowEarly", { form: verbForm(medicine) })}</DropdownMenuItem>
          <DropdownMenuItem onClick={onSkip}>{t("home.skip")}</DropdownMenuItem>
          <DropdownMenuItem onClick={onMore}>{t("home.moreOptions")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function DoneRow({
  medicine,
  log,
  timeZone,
  loggedBy,
  highlight,
  onEdit,
  onMore,
}: {
  medicine: MedicineDTO;
  log: LogEntry;
  timeZone: string;
  loggedBy: string | null;
  /** Just logged by someone else: a short glow. */
  highlight?: boolean;
  onEdit: () => void;
  onMore: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const skipped = log.status === "skipped";
  return (
    <li className={cn("flex items-center pr-2 transition-colors duration-700", highlight && "bg-teal-500/15")}>
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2 text-left hover:bg-accent/50"
      >
        <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">
          {formatTime(log.takenAt, locale, timeZone)}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full",
              skipped ? "bg-muted text-muted-foreground" : "bg-teal-600 text-white",
            )}
            aria-hidden
          >
            {skipped ? <Minus className="size-3.5" /> : <Check className="size-3.5" />}
          </span>
          <span className="min-w-0">
            <span className={cn("block truncate", skipped && "text-muted-foreground")}>{medicine.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {loggedAmount(medicine, log.amount, t)}
              {log.status === "uncertain" && <> · {t("history.uncertain")}</>}
              {skipped && <> · {t("history.skipped")}</>}
              {loggedBy && <> · {t("people.loggedBy", { name: loggedBy })}</>}
            </span>
          </span>
        </span>
      </button>
      <MoreButton onClick={onMore} />
    </li>
  );
}

/** "3 days left", "due today", "2 days overdue", "tomorrow 10:30", "Wed 3 Dec · in 11 days". */
export function careDueText(
  status: CareStatus,
  /** A one-off (once mode): days ahead name the date. */
  once: boolean,
  t: ReturnType<typeof useTranslations>,
  locale: string,
  timeZone: string,
): { text: string; alert: boolean } {
  const time = status.dueAt !== null ? formatTime(status.dueAt, locale, timeZone) : null;
  const d = status.daysLeft;
  if (d < 0) return { text: t("care.overdue", { count: -d }), alert: true };
  if (d === 0) return { text: time ? t("care.todayAt", { time }) : t("care.dueToday"), alert: true };
  if (d === 1 && time) return { text: t("care.tomorrowAt", { time }), alert: false };
  if (once && d > 1) return { text: t("care.onDate", { date: formatLocalDate(status.dueDate, locale), count: d }), alert: false };
  if (once) return { text: t("care.tomorrow"), alert: false };
  return { text: t("care.daysLeft", { count: d }), alert: false };
}

/** "last done 4 days ago" / "not done yet" (flex only; one-offs have no history). */
function lastDoneText(medicine: MedicineDTO, status: CareStatus, now: number, t: ReturnType<typeof useTranslations>, locale: string, timeZone: string) {
  if (medicine.mode !== "flex") return null;
  if (status.lastAt === null) return t(kindOf(medicine) === "measure" ? "care.neverMeasured" : "care.neverDone");
  return t(kindOf(medicine) === "measure" ? "care.lastMeasured" : "care.lastDone", { when: formatDaysAgo(status.lastAt, now, locale, timeZone, t) });
}

/** A task / to-do / measurement on Due now: its deadline, and Done (or Log for a measurement). */
export function CareDueRow({
  medicine,
  status,
  timeZone,
  now,
  onDone,
  onMore,
}: {
  medicine: MedicineDTO;
  status: CareStatus;
  timeZone: string;
  now: number;
  onDone: () => void;
  onMore: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const due = careDueText(status, medicine.mode === "once", t, locale, timeZone);
  const last = lastDoneText(medicine, status, now, t, locale, timeZone);
  return (
    <li className="flex items-center gap-3 py-2.5 pl-4 pr-2">
      <span className="flex w-12 shrink-0 justify-center text-muted-foreground" aria-hidden>
        <CalendarClock className="size-5" />
      </span>
      <Name
        medicine={medicine}
        sub={
          <>
            <span className={cn(due.alert && "font-medium text-amber-700 dark:text-amber-400")}>{due.text}</span>
            {last && <> · {last}</>}
          </>
        }
      />
      <Button className="h-10 px-4" onClick={onDone}>
        {t("home.take", { form: verbForm(medicine) })}
      </Button>
      <MoreButton onClick={onMore} />
    </li>
  );
}

/** A task that isn't due yet (Tasks section): when it is due, and a quiet Done. */
export function CareRow({
  medicine,
  status,
  timeZone,
  now,
  highlight,
  onDone,
  onMore,
}: {
  medicine: MedicineDTO;
  status: CareStatus;
  timeZone: string;
  now: number;
  highlight?: boolean;
  onDone: () => void;
  onMore: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const due = careDueText(status, medicine.mode === "once", t, locale, timeZone);
  const last = lastDoneText(medicine, status, now, t, locale, timeZone);
  return (
    <li className={cn("flex items-center gap-3 py-2.5 pl-4 pr-2 transition-colors duration-700", highlight && "bg-teal-500/15")}>
      <Name
        medicine={medicine}
        sub={
          <>
            {last && <>{last} · </>}
            {due.text}
          </>
        }
      />
      <Button size="sm" variant="outline" onClick={onDone}>
        {t("home.take", { form: verbForm(medicine) })}
      </Button>
      <MoreButton onClick={onMore} />
    </li>
  );
}
