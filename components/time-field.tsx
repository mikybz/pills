"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { localDate, localTime, zonedToUtc } from "@/lib/tz";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 24-hour time entry as two numeric fields (HH : MM). Never a native
 * <input type="time">, which follows the device locale and can show AM/PM.
 */
export function TimeField({
  value,
  onChange,
  className,
  label,
}: {
  /** "HH:MM" */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  label?: string;
}) {
  const [hh, mm] = value.split(":");
  const [text, setText] = useState({ hh, mm });
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setText({ hh, mm });
  }
  const minuteRef = useRef<HTMLInputElement>(null);

  function commit(next: { hh: string; mm: string }) {
    const h = Math.min(23, Math.max(0, Number(next.hh) || 0));
    const m = Math.min(59, Math.max(0, Number(next.mm) || 0));
    const v = `${pad(h)}:${pad(m)}`;
    setText({ hh: pad(h), mm: pad(m) });
    if (v !== value) onChange(v);
  }

  const field = "h-10 w-12 px-1 text-center text-base tabular-nums";
  return (
    <span className={cn("inline-flex items-center gap-1", className)} role="group" aria-label={label}>
      <Input
        inputMode="numeric"
        aria-label={label ? `${label} HH` : "HH"}
        className={field}
        maxLength={2}
        value={text.hh}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
          const next = { ...text, hh: digits };
          setText(next);
          if (digits.length === 2 || Number(digits) > 2) {
            commit(next);
            minuteRef.current?.focus();
          }
        }}
        onBlur={() => commit(text)}
      />
      <span className="font-semibold text-muted-foreground">:</span>
      <Input
        ref={minuteRef}
        inputMode="numeric"
        aria-label={label ? `${label} MM` : "MM"}
        className={field}
        maxLength={2}
        value={text.mm}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
          const next = { ...text, mm: digits };
          setText(next);
          if (digits.length === 2) commit(next);
        }}
        onBlur={() => commit(text)}
      />
    </span>
  );
}

/** Native date input (fine: no AM/PM) + TimeField, interpreted in `timeZone`. */
export function DateTimeField({
  value,
  onChange,
  timeZone,
  max,
}: {
  value: number;
  onChange: (value: number) => void;
  timeZone: string;
  max?: number;
}) {
  const date = localDate(value, timeZone);
  const time = localTime(value, timeZone);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="date"
        className="h-10 w-auto"
        value={date}
        max={max !== undefined ? localDate(max, timeZone) : undefined}
        onChange={(e) => e.target.value && onChange(zonedToUtc(e.target.value, time, timeZone))}
      />
      <TimeField value={time} onChange={(t) => onChange(zonedToUtc(date, t, timeZone))} />
    </div>
  );
}
