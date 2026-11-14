"use client";

import { useTranslations } from "next-intl";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const SECTIONS = [
  "gettingStarted",
  "checklist",
  "late",
  "doubleDose",
  "asNeeded",
  "reminders",
  "shared",
  "unsure",
  "backdate",
  "install",
] as const;

export function HelpSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("help");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-8 text-sm text-muted-foreground">
          {SECTIONS.map((s) => (
            <section key={s}>
              <h3 className="mb-1 font-medium text-foreground">{t(`${s}Title`)}</h3>
              <p className="whitespace-pre-line">{t(`${s}Body`)}</p>
            </section>
          ))}
          <section className="rounded-lg border border-amber-300/50 bg-amber-500/10 p-3">
            <h3 className="mb-1 font-medium text-foreground">{t("disclaimerTitle")}</h3>
            {t("disclaimer")}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
