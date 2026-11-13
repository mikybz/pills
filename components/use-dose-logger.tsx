"use client";

import { useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { WarningDialog } from "@/components/warning-dialog";
import type { LogRequest } from "@/components/log-sheet";
import { api } from "@/lib/client";
import { formatDose, formatWhen } from "@/lib/format";
import { closeStaleNotifications } from "@/lib/push-client";
import { checkDose, type CheckResult } from "@/lib/safety";
import { slotForLog, type LogEntry } from "@/lib/schedule";
import { localDate } from "@/lib/tz";
import {
  scheduleOf,
  type DoseDTO,
  type LogResponse,
  type MedicineDTO,
  type PersonDay,
  type ProfileDTO,
} from "@/lib/types";

/** A request with its time fixed and its slot resolved (null = no slot, undefined = server assigns). */
type Resolved = Omit<LogRequest, "slotAt"> & { takenAt: number; slotAt: number | null | undefined };

interface Pending {
  medicine: MedicineDTO;
  req: Resolved;
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
  const locale = useLocale();
  const [pending, setPending] = useState<Pending | null>(null);

  /** The slot a log at `at` answers, from a row (`rowSlotAt`) or not — same rule as the server. */
  const slotFor = useCallback(
    (medicine: MedicineDTO, at: number, rowSlotAt: number | undefined, now: number) =>
      slotForLog(scheduleOf(medicine, person), logsFor(medicine.id), rowSlotAt, at, now, {
        leadMin: profile?.remindLeadMin ?? 10,
        anchor: Date.parse(medicine.scheduleReviewedAt ?? medicine.createdAt),
      }),
    [person, logsFor, profile],
  );

  const persist = useCallback(
    async (medicine: MedicineDTO, req: Resolved, confirmed = false) => {
      try {
        const res = await api<LogResponse>("/api/doses", {
          method: "POST",
          body: JSON.stringify({
            medicineId: medicine.id,
            amount: req.amount,
            takenAt: new Date(req.takenAt).toISOString(),
            // A row's slot is sent as resolved (null = no slot); without a row the server assigns.
            ...(req.slotAt !== undefined
              ? { slotAt: req.slotAt === null ? null : new Date(req.slotAt).toISOString() }
              : {}),
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
        const now = Date.now();
        // A log for another day won't show under Done, so the toast names the day and time.
        const otherDay = localDate(req.takenAt, person.timezone) !== localDate(now, person.timezone);
        const message = serverWarning
          ? t("warning.afterTheFact", { name: medicine.name })
          : req.status === "skipped"
            ? t("home.skippedToast", { name: medicine.name })
            : otherDay
              ? t("home.loggedAt", {
                  name: medicine.name,
                  when: formatWhen(req.takenAt, now, locale, person.timezone, t),
                })
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
    [t, locale, person, onLogged, onUndone, logsFor],
  );

  const requestLog = useCallback(
    (medicine: MedicineDTO, request: LogRequest) => {
      const now = Date.now();
      const takenAt = request.takenAt ?? now;
      const slotAt = slotFor(medicine, takenAt, request.slotAt, now);
      // From a row, send the resolved slot (a dose backdated past the row's window
      // answers an earlier slot or none); otherwise the server assigns with fresh data.
      const req: Resolved = { ...request, takenAt, slotAt: request.slotAt !== undefined ? slotAt : undefined };
      if (req.status === "skipped") {
        void persist(medicine, req);
        return;
      }
      const schedule = scheduleOf(medicine, person);
      const logs = logsFor(medicine.id);
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
    [persist, person, logsFor, profile, slotFor],
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

  return { requestLog, dialog, slotFor };
}
