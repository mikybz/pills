"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { colorClasses, type MedicineDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * "Log an earlier dose": a quiet button that picks a medicine (skipped when
 * there is only one) and hands it on; the caller opens the log sheet with no
 * row slot and the time field open.
 */
export function EarlierDoseButton({
  medicines,
  onPick,
  className,
}: {
  medicines: MedicineDTO[];
  onPick: (medicine: MedicineDTO) => void;
  className?: string;
}) {
  const t = useTranslations();
  const [picking, setPicking] = useState(false);
  if (!medicines.length) return null;
  return (
    <>
      <Button
        variant="ghost"
        className={cn("w-full text-muted-foreground", className)}
        onClick={() => (medicines.length === 1 ? onPick(medicines[0]) : setPicking(true))}
      >
        <History className="size-4" /> {t("home.logEarlier")}
      </Button>
      {picking && (
        <Sheet open onOpenChange={(o) => !o && setPicking(false)}>
          <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>{t("home.pickMedicine")}</SheetTitle>
            </SheetHeader>
            <ul className="divide-y px-4 pb-6">
              {medicines.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 py-3 text-left hover:bg-accent/50"
                    onClick={() => {
                      setPicking(false);
                      onPick(m);
                    }}
                  >
                    <span className={cn("size-3 shrink-0 rounded-full", (colorClasses[m.color] ?? colorClasses.blue).dot)} />
                    <span className="font-medium">{m.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
