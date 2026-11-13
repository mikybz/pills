"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { WarningDialog } from "@/components/warning-dialog";
import type { LogRequest } from "@/components/log-sheet";
import { api } from "@/lib/client";
import { formatDose } from "@/lib/format";
import { closeStaleNotifications } from "@/lib/push-client";
import { checkDose, type CheckResult } from "@/lib/safety";
import { assignSlot, isScheduled, type LogEntry } from "@/lib/schedule";
import {
  scheduleOf,
  type DoseDTO,
  type LogResponse,
  type MedicineDTO,
  type PersonDay,
  type ProfileDTO,
} from "@/lib/types";

interface Pending {
  medicine: MedicineDTO;
  req: LogRequest & { takenAt: number };
  check: CheckResult;
}

/**
 * Logging with the client-side dose check (same pure function as the server),
 * the single confirm sheet, and the 8-second undo toast.
 */
export function useDoseLogger({
  profile,
  person,
  logsFor,
  onLogged,
  onUndone,
}: {
  profile: ProfileDTO | null;
  /** The current person: time zone and day window. */
  person: PersonDay;
  logsFor: (medicineId: string) => LogEntry[];
  onLogged: (dose: DoseDTO) => void;
  onUndone: (doseId: string) => void;
}) {
  const t = useTranslations();
  const [pending, setPending] = useState<Pending | null>(null);

  const persist = useCallback(
    async (medicine: MedicineDTO, req: LogRequest & { takenAt: number }, confirmed = false) => {
      try {
        const res = await api<LogResponse>("/api/doses", {
          method: "POST",
          body: JSON.stringify({
            medicineId: medicine.id,
            amount: req.amount,
            takenAt: new Date(req.takenAt).toISOString(),
            // Only an explicitly chosen row is sent; otherwise the server assigns.
            ...(req.slotAt !== undefined ? { slotAt: new Date(req.slotAt).toISOString() } : {}),
            status: req.status,
            note: req.note,
          }),
        });
        onLogged(res.dose);
        const logged = res.dose;
        void closeStaleNotifications(
          (medicineId, slotAt) =>
            (medicineId === medicine.id && logged.slotAt !== null && Date.parse(logged.slotAt) === slotAt) ||
            logsFor(medicineId).some((l) => l.slotAt === slotAt),
        ).catch(() => {});
        // The server re-checks with fresh data (e.g. another user just logged it).
        const serverWarning =
          !confirmed && res.check.level === "warn" && res.check.reasons[0]?.code !== "overIntake"
            ? res.check.reasons[0]
            : null;
        const message = serverWarning
          ? t("warning.afterTheFact", { name: medicine.name })
          : req.status === "skipped"
            ? t("home.skippedToast", { name: medicine.name })
            : t("home.logged", { dose: formatDose(req.amount, medicine.unit, t), name: medicine.name });
        (serverWarning ? toast.warning : toast.success)(message, {
          duration: 8000,
          action: {
            label: t("home.undo"),
            onClick: async () => {
              try {
                await api(`/api/doses/${res.dose.id}`, { method: "DELETE" });
                onUndone(res.dose.id);
                toast.info(t("home.undone"));
              } catch {
                toast.error(t("common.error"));
              }
            },
          },
        });
      } catch {
        toast.error(t("common.error"));
      }
    },
    [t, onLogged, onUndone, logsFor],
  );

  const requestLog = useCallback(
    (medicine: MedicineDTO, request: LogRequest) => {
      const req = { ...request, takenAt: request.takenAt ?? Date.now() };
      if (req.status === "skipped") {
        void persist(medicine, req);
        return;
      }
      const schedule = scheduleOf(medicine, person);
      const logs = logsFor(medicine.id);
      const slotAt =
        req.slotAt !== undefined
          ? req.slotAt
          : isScheduled(schedule.mode)
            ? assignSlot(schedule, logs, req.takenAt, Date.now(), {
                leadMin: profile?.remindLeadMin ?? 10,
                anchor: Date.parse(medicine.scheduleReviewedAt ?? medicine.createdAt),
              })
            : null;
      const check = checkDose({
        schedule,
        limits: {
          maxPerIntake: medicine.maxPerIntake,
          maxPerDay: medicine.maxPerDay,
          minIntervalMin: medicine.minIntervalMin,
        },
        logs,
        req: { amount: req.amount, at: req.takenAt, status: req.status, slotAt },
        countUncertain: profile?.countUncertain ?? true,
      });
      if (check.level === "warn") setPending({ medicine, req, check });
      else void persist(medicine, req);
    },
    [persist, person, logsFor, profile],
  );

  const dialog = pending ? (
    <WarningDialog
      check={pending.check}
      medicine={pending.medicine}
      timeZone={person.timezone}
      onConfirm={() => {
        void persist(pending.medicine, pending.req, true);
        setPending(null);
      }}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { requestLog, dialog };
}
