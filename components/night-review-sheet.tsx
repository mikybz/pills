"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/client";
import { colorClasses, type NightCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";

type Choice = "move" | "keep" | "leave";

/**
 * Preview of the medicines with a dose in the sleep window, old → new times
 * (`fitTimes`). Per medicine: Move (default), Keep at night (sets
 * aroundTheClock) or Leave for now. Apply = one PATCH per changed medicine, so
 * each goes through the normal schedule-edit path (ScheduleVersion). Nothing
 * moves without Apply. Render only while open.
 */
export function NightReviewSheet({
  candidates,
  window,
  onClose,
  onApplied,
}: {
  candidates: NightCandidate[];
  /** "07:00–23:00" */
  window: string;
  onClose: () => void;
  /** After Apply; `leftSome` = at least one medicine was left for now. */
  onApplied: (leftSome: boolean) => void;
}) {
  const t = useTranslations();
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(candidates.map((c) => [c.medicine.id, "move" as Choice])),
  );
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    try {
      await Promise.all(
        candidates.map((c) => {
          const choice = choices[c.medicine.id];
          if (choice === "leave") return null;
          const body = choice === "move" ? { times: c.to } : { aroundTheClock: true };
          return api(`/api/medicines/${c.medicine.id}`, { method: "PATCH", body: JSON.stringify(body) });
        }),
      );
      toast.success(t("night.applied"));
      onApplied(candidates.some((c) => choices[c.medicine.id] === "leave"));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const options: { value: Choice; label: string }[] = [
    { value: "move", label: t("night.move") },
    { value: "keep", label: t("night.keep") },
    { value: "leave", label: t("night.leave") },
  ];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Moon className="size-4" /> {t("night.title")}
          </SheetTitle>
          <SheetDescription>{t("night.intro", { window })}</SheetDescription>
        </SheetHeader>
        <ul className="space-y-4 px-4">
          {candidates.map((c) => {
            const choice = choices[c.medicine.id];
            const colors = colorClasses[c.medicine.color] ?? colorClasses.blue;
            return (
              <li key={c.medicine.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={cn("size-3 shrink-0 rounded-full", colors.dot)} />
                  <span className="font-medium">{c.medicine.name}</span>
                </div>
                <p className="flex flex-wrap items-center gap-x-2 pl-5 text-sm tabular-nums">
                  <span className={cn(choice === "move" && "text-muted-foreground line-through")}>
                    {c.from.join(", ")}
                  </span>
                  {choice === "move" && (
                    <>
                      <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                      <span className="font-medium">{c.to.join(", ")}</span>
                    </>
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5 pl-5" role="radiogroup" aria-label={c.medicine.name}>
                  {options.map((o) => (
                    <Button
                      key={o.value}
                      type="button"
                      size="sm"
                      role="radio"
                      aria-checked={choice === o.value}
                      variant={choice === o.value ? "default" : "outline"}
                      onClick={() => setChoices((p) => ({ ...p, [c.medicine.id]: o.value }))}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-2 px-4 pb-6 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button className="flex-1" disabled={busy} onClick={apply}>
            {t("night.apply")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
