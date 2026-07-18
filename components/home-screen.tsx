"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MedicineCard } from "@/components/medicine-card";
import { LogSheet, type LogRequest } from "@/components/log-sheet";
import { WarningDialog } from "@/components/warning-dialog";
import { Onboarding } from "@/components/onboarding";
import { api } from "@/lib/client";
import {
  parsePresets,
  type DoseDTO,
  type LogResponse,
  type MedicineDTO,
  type ProfileDTO,
} from "@/lib/types";
import {
  evaluateDose,
  type DoseStatus,
  type SafetyConfig,
  type SafetyResult,
} from "@/lib/safety";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PendingLog {
  medicine: MedicineDTO;
  req: LogRequest;
  safety: SafetyResult;
}

export function HomeScreen() {
  const t = useTranslations();
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [medicines, setMedicines] = useState<MedicineDTO[] | null>(null);
  const [doses, setDoses] = useState<DoseDTO[]>([]);
  const [sheetMedicine, setSheetMedicine] = useState<MedicineDTO | null>(null);
  const [pending, setPending] = useState<PendingLog | null>(null);

  const reload = useCallback(async () => {
    const from = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
    const [p, m, d] = await Promise.all([
      api<ProfileDTO>("/api/profile"),
      api<MedicineDTO[]>("/api/medicines"),
      api<DoseDTO[]>(`/api/doses?from=${encodeURIComponent(from)}`),
    ]);
    setProfile(p);
    setMedicines(m);
    setDoses(d);
  }, []);

  useEffect(() => {
    reload().catch(() => toast.error(t("common.error")));
  }, [reload, t]);

  const dosesByMedicine = useMemo(() => {
    const map = new Map<string, DoseDTO[]>();
    for (const d of doses) {
      const list = map.get(d.medicineId) ?? [];
      list.push(d);
      map.set(d.medicineId, list);
    }
    return map;
  }, [doses]);

  const configFor = useCallback(
    (m: MedicineDTO): SafetyConfig => ({
      maxPerIntake: m.maxPerIntake,
      maxPerDay: m.maxPerDay,
      minIntervalMin: m.minIntervalMin,
      slack: profile?.strictness,
      wakeWindowH: profile?.wakeWindowH,
      countUncertain: profile?.countUncertain,
    }),
    [profile],
  );

  const persist = useCallback(
    async (medicine: MedicineDTO, req: LogRequest) => {
      try {
        const res = await api<LogResponse>("/api/doses", {
          method: "POST",
          body: JSON.stringify({
            medicineId: medicine.id,
            amount: req.amount,
            takenAt: req.takenAt.toISOString(),
            status: req.status,
            note: req.note,
          }),
        });
        setDoses((ds) =>
          [res.dose, ...ds].sort(
            (a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime(),
          ),
        );
        toast.success(
          t("home.logged", {
            amount: formatAmount(req.amount),
            unit: medicine.unit,
            name: medicine.name,
          }),
          {
            duration: 8000,
            action: {
              label: t("home.undo"),
              onClick: async () => {
                await api(`/api/doses/${res.dose.id}`, { method: "DELETE" });
                setDoses((ds) => ds.filter((d) => d.id !== res.dose.id));
                toast.info(t("home.undone"));
              },
            },
          },
        );
      } catch {
        toast.error(t("common.error"));
      }
    },
    [t],
  );

  const requestLog = useCallback(
    (medicine: MedicineDTO, req: LogRequest) => {
      const entries = (dosesByMedicine.get(medicine.id) ?? []).map((d) => ({
        amount: d.amount,
        takenAt: new Date(d.takenAt),
        status: d.status as DoseStatus,
      }));
      // Skipped doses don't need a safety check.
      const safety =
        req.status === "skipped"
          ? null
          : evaluateDose(configFor(medicine), entries, req.amount, req.takenAt);
      if (safety && safety.level !== "green") {
        setPending({ medicine, req, safety });
      } else {
        void persist(medicine, req);
      }
    },
    [dosesByMedicine, configFor, persist],
  );

  if (!medicines || !profile) {
    return <p className="py-12 text-center text-muted-foreground">{t("common.loading")}</p>;
  }

  if (!profile.onboarded) {
    return (
      <Onboarding
        onDone={async () => {
          await api("/api/profile", {
            method: "PATCH",
            body: JSON.stringify({ onboarded: true }),
          });
          setProfile({ ...profile, onboarded: true });
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <TodayRibbon medicines={medicines} doses={doses} />

      {medicines.length === 0 && (
        <Card className="items-center gap-2 p-8 text-center">
          <h2 className="font-semibold">{t("home.noMedicines")}</h2>
          <p className="text-sm text-muted-foreground">{t("home.noMedicinesHint")}</p>
          <Link
            href="/settings"
            className={cn(buttonVariants(), "mt-2")}
          >
            <Plus className="size-4" /> {t("home.addMedicine")}
          </Link>
        </Card>
      )}

      {medicines.map((m) => (
        <MedicineCard
          key={m.id}
          medicine={m}
          doses={dosesByMedicine.get(m.id) ?? []}
          safetyConfig={configFor(m)}
          onQuickLog={(amount) =>
            requestLog(m, { amount, takenAt: new Date(), status: "taken" })
          }
          onMore={() => setSheetMedicine(m)}
        />
      ))}

      <LogSheet
        medicine={sheetMedicine}
        open={sheetMedicine !== null}
        onOpenChange={(o) => !o && setSheetMedicine(null)}
        onSubmit={(req) => {
          const m = sheetMedicine;
          setSheetMedicine(null);
          if (m) requestLog(m, req);
        }}
      />

      <WarningDialog
        safety={pending?.safety ?? null}
        open={pending !== null}
        onConfirm={() => {
          if (pending) void persist(pending.medicine, pending.req);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function TodayRibbon({
  medicines,
  doses,
}: {
  medicines: MedicineDTO[];
  doses: DoseDTO[];
}) {
  const t = useTranslations();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const rows = medicines
    .map((m) => {
      const total = doses
        .filter(
          (d) =>
            d.medicineId === m.id &&
            d.status !== "skipped" &&
            new Date(d.takenAt) >= startOfDay,
        )
        .reduce((s, d) => s + d.amount, 0);
      return { m, total };
    })
    .filter((r) => r.m.maxPerDay || r.total > 0);

  if (!rows.length) return null;

  return (
    <Card className="gap-2.5 p-4">
      <h2 className="text-sm font-medium text-muted-foreground">{t("home.today")}</h2>
      {rows.map(({ m, total }) => {
        const frac = m.maxPerDay ? Math.min(1, total / m.maxPerDay) : 0;
        return (
          <div key={m.id}>
            <div className="mb-1 flex justify-between text-sm">
              <span>{m.name}</span>
              <span className="font-medium">
                {formatAmount(total)}
                {m.maxPerDay
                  ? ` ${t("home.of")} ${formatAmount(m.maxPerDay)}`
                  : ""}{" "}
                {m.unit}
              </span>
            </div>
            {m.maxPerDay && (
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    frac >= 1 ? "bg-red-500" : frac >= 0.85 ? "bg-amber-400" : "bg-teal-500",
                  )}
                  style={{ width: `${frac * 100}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}
