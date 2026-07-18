"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ClipboardList, Palette, Pill } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const t = useTranslations("onboarding");
  const th = useTranslations("help");
  const [accepted, setAccepted] = useState(false);

  const steps = [
    { icon: Pill, title: t("step1Title"), body: t("step1Body") },
    { icon: ClipboardList, title: t("step2Title"), body: t("step2Body") },
    { icon: Palette, title: t("step3Title"), body: t("step3Body") },
  ];

  return (
    <div className="space-y-4 py-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">{t("welcomeTitle")}</h1>
        <p className="mt-2 text-muted-foreground">{t("welcomeBody")}</p>
      </div>
      {steps.map((s) => (
        <Card key={s.title} className="flex-row items-start gap-3 p-4">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-teal-600/10 text-teal-600 dark:text-teal-400">
            <s.icon className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">{s.title}</h2>
            <p className="text-sm text-muted-foreground">{s.body}</p>
          </div>
        </Card>
      ))}
      <Card className="gap-2 border-amber-300/50 bg-amber-500/10 p-4 text-sm">
        <h2 className="font-semibold">{th("disclaimerTitle")}</h2>
        <p className="text-muted-foreground">{th("disclaimer")}</p>
        <label className="mt-1 flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-teal-600"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          {t("disclaimerAccept")}
        </label>
      </Card>
      <Button className="w-full" size="lg" disabled={!accepted} onClick={onDone}>
        {t("start")}
      </Button>
    </div>
  );
}
