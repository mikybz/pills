"use client";

import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function HelpSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("help");

  const sections: { title: string; body: React.ReactNode }[] = [
    { title: t("gettingStartedTitle"), body: t("gettingStartedBody") },
    {
      title: t("colorsTitle"),
      body: (
        <ul className="space-y-1.5">
          <li className="flex gap-2">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-emerald-500" />
            {t("colorsGreen")}
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-amber-400" />
            {t("colorsYellow")}
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-red-500" />
            {t("colorsRed")}
          </li>
        </ul>
      ),
    },
    { title: t("spacingTitle"), body: t("spacingBody") },
    { title: t("unsureTitle"), body: t("unsureBody") },
    { title: t("backdateTitle"), body: t("backdateBody") },
    { title: t("installTitle"), body: t("installBody") },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-8 text-sm text-muted-foreground">
          {sections.map((s) => (
            <section key={s.title}>
              <h3 className="mb-1 font-medium text-foreground">{s.title}</h3>
              {s.body}
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
