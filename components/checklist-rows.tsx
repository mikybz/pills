"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, Ellipsis, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDose, formatDuration, formatTime } from "@/lib/format";
import type { LogEntry, Slot } from "@/lib/schedule";
import { colorClasses, doseAmountOf, type MedicineDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

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

function Name({ medicine, sub }: { medicine: MedicineDTO; sub?: React.ReactNode }) {
  const t = useTranslations();
  const colors = colorClasses[medicine.color] ?? colorClasses.blue;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className={cn("h-8 w-1 shrink-0 rounded-full", colors.dot)} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate font-medium">{medicine.name}</span>
        <span className="block text-xs text-muted-foreground">
          {formatDose(doseAmountOf(medicine), medicine.unit, t)}
          {sub && <> · {sub}</>}
        </span>
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
        {t("home.take")}
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
        <Name medicine={medicine} sub={<span className="font-medium">{t("home.missedBadge")}</span>} />
        <MoreButton onClick={onMore} />
      </div>
      <div className="flex gap-2 pl-15">
        <Button size="sm" variant="outline" onClick={onTakeLate}>
          {t("home.takeLate")}
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
          <Name medicine={medicine} />
          <Ellipsis className="size-5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={onTakeNow}>{t("home.takeNowEarly")}</DropdownMenuItem>
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
  onEdit,
  onMore,
}: {
  medicine: MedicineDTO;
  log: LogEntry;
  timeZone: string;
  loggedBy: string | null;
  onEdit: () => void;
  onMore: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const skipped = log.status === "skipped";
  return (
    <li className="flex items-center pr-2">
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
              {formatDose(log.amount, medicine.unit, t)}
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
