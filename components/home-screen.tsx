"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellRing, CircleCheckBig, ClipboardCheck, Moon, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AsNeededCard } from "@/components/as-needed-card";
import { DoneRow, DueRow, LaterRow, MissedRow, Section } from "@/components/checklist-rows";
import { EarlierDoseButton } from "@/components/earlier-dose";
import { EditDoseDialog } from "@/components/edit-dose-dialog";
import { LogSheet } from "@/components/log-sheet";
import { MedicineDialog } from "@/components/medicine-dialog";
import { NightReviewSheet } from "@/components/night-review-sheet";
import { Onboarding } from "@/components/onboarding";
import { ReviewScreen } from "@/components/review-screen";
import { usePersons } from "@/components/person-context";
import { useDoseLogger } from "@/components/use-dose-logger";
import { api } from "@/lib/client";
import { buildChecklist } from "@/lib/checklist";
import { closeStaleNotifications, usePushSupport, useDevicePush } from "@/lib/push-client";
import { DAY, isFinished, type LogEntry } from "@/lib/schedule";
import {
  currentScheduleFrom,
  doseAmountOf,
  dayOf,
  nightCandidates,
  personDayOf,
  scheduleOf,
  toLogEntries,
  type DoseDTO,
  type MedicineDTO,
  type ProfileDTO,
} from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

interface HomeData {
  personId: string;
  profile: ProfileDTO;
  medicines: MedicineDTO[];
  doses: DoseDTO[];
}

async function loadHome(personId: string, onMigrated: () => void): Promise<HomeData> {
  const pid = encodeURIComponent(personId);
  const medsUrl = `/api/medicines?personId=${pid}&archived=true`;
  const [profile, first] = await Promise.all([api<ProfileDTO>("/api/profile"), api<MedicineDTO[]>(medsUrl)]);
  let medicines = first;
  if (medicines.some((m) => m.mode === null)) {
    // Medicines from before schedules: guess once (idempotent), then review.
    await api(`/api/persons/${pid}/migrate`, {
      method: "POST",
      body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    medicines = await api<MedicineDTO[]>(medsUrl);
    onMigrated();
  }
  const from = new Date(Date.now() - 3 * DAY).toISOString();
  const doses = await api<DoseDTO[]>(`/api/doses?personId=${pid}&from=${encodeURIComponent(from)}`);
  return { personId, profile, medicines, doses };
}

const REVIEW_KEY = "pills.reviewClosed";
const PROMPT_KEY = "pills.reminderPromptDismissed";
/** "Leave for now" in the night-dose preview hides the banner for this session. */
const NIGHT_KEY = "pills.nightLeft";

function readFlag(storage: "session" | "local", key: string) {
  try {
    return (storage === "session" ? sessionStorage : localStorage).getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(storage: "session" | "local", key: string) {
  try {
    (storage === "session" ? sessionStorage : localStorage).setItem(key, "1");
  } catch {
    // private mode etc.
  }
}

type SheetTarget = { medicine: MedicineDTO; slotAt?: number; initialAt?: number };

export function HomeScreen() {
  const t = useTranslations();
  const { current, meId, reload: reloadPersons } = usePersons();
  const personId = current?.id;
  const person = useMemo(() => personDayOf(current), [current]);
  const timeZone = person.timezone;
  const now = useNow();
  const support = usePushSupport();
  const device = useDevicePush(support);

  const [data, setData] = useState<HomeData | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [editing, setEditing] = useState<DoseDTO | null>(null);
  const [changing, setChanging] = useState<MedicineDTO | null>(null);
  const [reviewClosed, setReviewClosed] = useState(() => typeof window !== "undefined" && readFlag("session", REVIEW_KEY));
  const [promptDismissed, setPromptDismissed] = useState(
    () => typeof window !== "undefined" && readFlag("local", PROMPT_KEY),
  );
  const [nightOpen, setNightOpen] = useState(false);
  const [nightLeft, setNightLeft] = useState(() => typeof window !== "undefined" && readFlag("session", NIGHT_KEY));

  useEffect(() => {
    if (!personId) return;
    let alive = true;
    loadHome(personId, () => void reloadPersons())
      .then((d) => alive && setData(d))
      .catch(() => toast.error(t("common.error")));
    return () => {
      alive = false;
    };
  }, [personId, version, reloadPersons, t]);

  // "Taken" from a notification: the service worker tells open windows to refresh.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "doses-changed") reload();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [reload]);

  const ready = data && data.personId === personId ? data : null;
  const medicines = useMemo(() => ready?.medicines ?? [], [ready]);
  const doses = useMemo(() => ready?.doses ?? [], [ready]);
  const medById = useMemo(() => new Map(medicines.map((m) => [m.id, m])), [medicines]);

  const logsByMed = useMemo(() => {
    const map = new Map<string, LogEntry[]>();
    for (const m of medicines) {
      map.set(m.id, toLogEntries(doses.filter((d) => d.medicineId === m.id), m));
    }
    return map;
  }, [medicines, doses]);
  const logsFor = useCallback((id: string) => logsByMed.get(id) ?? [], [logsByMed]);

  // When the app opens (and after each reload), close notifications for slots already logged.
  useEffect(() => {
    if (!ready) return;
    void closeStaleNotifications((medicineId, slotAt) =>
      (logsByMed.get(medicineId) ?? []).some((l) => l.slotAt === slotAt),
    ).catch(() => {});
  }, [ready, logsByMed]);

  const { requestLog, dialog, slotFor } = useDoseLogger({
    profile: ready?.profile ?? null,
    person,
    logsFor,
    onLogged: (dose) => setData((d) => (d ? { ...d, doses: [dose, ...d.doses] } : d)),
    onUndone: (id) => setData((d) => (d ? { ...d, doses: d.doses.filter((x) => x.id !== id) } : d)),
  });

  const active = useMemo(
    () => medicines.filter((m) => !m.archivedAt && !m.hidden && !isFinished(scheduleOf(m, person), now)),
    [medicines, person, now],
  );

  const checklist = useMemo(
    () =>
      buildChecklist(
        active.map((m) => ({
          id: m.id,
          schedule: scheduleOf(m, person),
          logs: logsFor(m.id),
          anchor: Date.parse(m.scheduleReviewedAt ?? m.createdAt),
          slotsFrom: m.scheduleChangedAt ? currentScheduleFrom(m) : null,
          missedFrom: currentScheduleFrom(m),
        })),
        now,
        ready?.profile.remindLeadMin ?? 10,
      ),
    [active, person, logsFor, now, ready],
  );

  const night = useMemo(() => nightCandidates(medicines, person, now), [medicines, person, now]);
  const windowText = `${person.wakeTime}–${person.bedTime}`;

  if (!ready || !current) {
    return <p className="py-12 text-center text-muted-foreground">{t("common.loading")}</p>;
  }
  const profile = ready.profile;

  if (!profile.onboarded) {
    return (
      <Onboarding
        onDone={async () => {
          await api("/api/profile", { method: "PATCH", body: JSON.stringify({ onboarded: true }) });
          setData((d) => (d ? { ...d, profile: { ...d.profile, onboarded: true } } : d));
        }}
      />
    );
  }

  const unreviewed = medicines.filter((m) => !m.archivedAt && m.mode && !m.scheduleReviewedAt);
  const confirm = async (ids?: string[]) => {
    try {
      await api(`/api/persons/${encodeURIComponent(current.id)}/review`, {
        method: "POST",
        body: JSON.stringify(ids ? { medicineIds: ids } : {}),
      });
      reload();
    } catch {
      toast.error(t("common.error"));
    }
  };
  const medicineDialog = changing && (
    <MedicineDialog
      medicine={changing}
      timeZone={timeZone}
      day={dayOf(person)}
      showReminderSwitch={support === "supported" && profile.remindersOn}
      onClose={() => setChanging(null)}
      onChanged={() => {
        setChanging(null);
        reload();
      }}
    />
  );

  if (unreviewed.length && !reviewClosed) {
    return (
      <>
        <ReviewScreen
          medicines={unreviewed}
          personName={current.isSelf ? null : current.name}
          onConfirm={(m) => confirm([m.id])}
          onConfirmAll={() => confirm()}
          onChange={setChanging}
          onClose={() => {
            writeFlag("session", REVIEW_KEY);
            setReviewClosed(true);
          }}
        />
        {medicineDialog}
      </>
    );
  }

  const loggedByOther = (doseId: string | undefined) => {
    const d = doses.find((x) => x.id === doseId);
    return d?.loggedBy && meId && d.loggedBy.id !== meId ? (d.loggedBy.name ?? d.loggedBy.email) : null;
  };
  const take = (m: MedicineDTO, slotAt: number) =>
    requestLog(m, { amount: doseAmountOf(m), status: "taken", slotAt });
  const skip = (m: MedicineDTO, slotAt: number) =>
    requestLog(m, { amount: doseAmountOf(m), status: "skipped", slotAt });

  const asNeeded = active.filter((m) => scheduleOf(m, person).mode === "asNeeded");
  const showPrompt =
    support === "supported" &&
    profile.remindersOn &&
    device.state === "off" &&
    !promptDismissed &&
    !unreviewed.length &&
    checklist.hasScheduled;
  const nothingLeft = checklist.hasScheduled && !checklist.due.length && !checklist.missed.length && !checklist.later.length;

  return (
    <div className="space-y-5">
      {unreviewed.length > 0 && (
        <Card className="flex-row items-center gap-3 border-amber-300/60 bg-amber-500/10 p-3">
          <ClipboardCheck className="size-5 shrink-0 text-amber-700 dark:text-amber-400" />
          <p className="flex-1 text-sm">{t("review.banner", { count: unreviewed.length })}</p>
          <Button size="sm" variant="outline" onClick={() => setReviewClosed(false)}>
            {t("review.open")}
          </Button>
        </Card>
      )}

      {night.length > 0 && !nightLeft && !unreviewed.length && (
        <Card className="flex-row items-center gap-3 p-3">
          <Moon className="size-5 shrink-0 text-muted-foreground" />
          <p className="flex-1 text-sm">{t("night.banner", { window: windowText })}</p>
          <Button size="sm" variant="outline" onClick={() => setNightOpen(true)}>
            {t("night.review")}
          </Button>
        </Card>
      )}

      {showPrompt && (
        <Card className="gap-2 p-4">
          <p className="flex items-center gap-2 font-medium">
            <BellRing className="size-4 text-teal-600" /> {t("reminders.promptTitle")}
          </p>
          <p className="text-sm text-muted-foreground">{t("reminders.promptBody")}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                device.enable().catch((e) =>
                  toast.error(e instanceof Error && e.message === "push_not_configured" ? t("reminders.notConfigured") : t("common.error")),
                )
              }
            >
              {t("reminders.enableHere")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                writeFlag("local", PROMPT_KEY);
                setPromptDismissed(true);
              }}
            >
              {t("reminders.notNow")}
            </Button>
          </div>
        </Card>
      )}

      {medicines.filter((m) => !m.archivedAt).length === 0 && (
        <Card className="items-center gap-2 p-8 text-center">
          <h2 className="font-semibold">{t("home.noMedicines")}</h2>
          <p className="text-sm text-muted-foreground">{t("home.noMedicinesHint")}</p>
          <Link href="/settings#medicines" className={cn(buttonVariants(), "mt-2")}>
            <Plus className="size-4" /> {t("home.addMedicine")}
          </Link>
        </Card>
      )}

      {checklist.due.length > 0 && (
        <Section title={t("home.dueNow")}>
          {checklist.due.map(({ medicineId, slot }) => {
            const m = medById.get(medicineId)!;
            return (
              <DueRow
                key={`${medicineId}:${slot.slotAt}`}
                medicine={m}
                slot={slot}
                timeZone={timeZone}
                now={now}
                onTake={() => take(m, slot.slotAt)}
                onMore={() => setSheet({ medicine: m, slotAt: slot.slotAt })}
              />
            );
          })}
        </Section>
      )}

      {checklist.missed.length > 0 && (
        <Section title={t("home.missed")} tone="alert">
          {checklist.missed.map(({ medicineId, slot }) => {
            const m = medById.get(medicineId)!;
            return (
              <MissedRow
                key={`${medicineId}:${slot.slotAt}`}
                medicine={m}
                slot={slot}
                timeZone={timeZone}
                onTakeLate={() => take(m, slot.slotAt)}
                onSkip={() => skip(m, slot.slotAt)}
                onMore={() => setSheet({ medicine: m, slotAt: slot.slotAt })}
              />
            );
          })}
        </Section>
      )}

      {checklist.later.length > 0 && (
        <Section title={t("home.laterToday")}>
          {checklist.later.map(({ medicineId, slot }) => {
            const m = medById.get(medicineId)!;
            return (
              <LaterRow
                key={`${medicineId}:${slot.slotAt}`}
                medicine={m}
                slot={slot}
                timeZone={timeZone}
                onTakeNow={() => take(m, slot.slotAt)}
                onSkip={() => skip(m, slot.slotAt)}
                onMore={() => setSheet({ medicine: m, slotAt: slot.slotAt })}
              />
            );
          })}
        </Section>
      )}

      {nothingLeft && (
        <Card className="flex-row items-center gap-3 border-teal-600/30 bg-teal-600/10 p-4">
          <CircleCheckBig className="size-6 shrink-0 text-teal-600 dark:text-teal-400" />
          <div>
            <p className="font-semibold">{t("home.allDone")}</p>
            <p className="text-sm text-muted-foreground">{t("home.allDoneHint")}</p>
          </div>
        </Card>
      )}

      {checklist.done.length > 0 && (
        <Section title={t("home.done")}>
          {checklist.done.map(({ medicineId, log }) => {
            const m = medById.get(medicineId)!;
            const dose = doses.find((d) => d.id === log.id);
            return (
              <DoneRow
                key={log.id}
                medicine={m}
                log={log}
                timeZone={timeZone}
                loggedBy={loggedByOther(log.id)}
                onEdit={() => dose && setEditing(dose)}
                onMore={() => setSheet({ medicine: m, slotAt: log.slotAt ?? undefined })}
              />
            );
          })}
        </Section>
      )}

      {asNeeded.length > 0 && (
        <section className="space-y-1.5">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("home.asNeeded")}
          </h2>
          <div className="space-y-2">
            {asNeeded.map((m) => {
              const logs = logsFor(m.id);
              const last = [...logs].filter((l) => l.status !== "skipped").sort((a, b) => b.takenAt - a.takenAt)[0];
              return (
                <AsNeededCard
                  key={m.id}
                  medicine={m}
                  logs={logs}
                  now={now}
                  timeZone={timeZone}
                  countUncertain={profile.countUncertain}
                  lastBy={loggedByOther(last?.id)}
                  onQuickLog={(amount) => requestLog(m, { amount, status: "taken" })}
                  onMore={() => setSheet({ medicine: m })}
                />
              );
            })}
          </div>
        </section>
      )}

      <EarlierDoseButton
        medicines={active}
        onPick={(m) => setSheet({ medicine: m, initialAt: Date.now() })}
      />

      {sheet && (
        <LogSheet
          medicine={sheet.medicine}
          timeZone={timeZone}
          slotAt={sheet.slotAt}
          initialAt={sheet.initialAt}
          countsAs={(at, n) => slotFor(sheet.medicine, at, sheet.slotAt, n)}
          onClose={() => setSheet(null)}
          onSubmit={(req) => {
            const m = sheet.medicine;
            setSheet(null);
            requestLog(m, req);
          }}
        />
      )}
      {editing && (
        <EditDoseDialog
          dose={editing}
          medicine={medById.get(editing.medicineId) ?? null}
          timeZone={timeZone}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {nightOpen && (
        <NightReviewSheet
          candidates={night}
          window={windowText}
          onClose={() => setNightOpen(false)}
          onApplied={(leftSome) => {
            if (leftSome) {
              writeFlag("session", NIGHT_KEY);
              setNightLeft(true);
            }
            setNightOpen(false);
            reload();
          }}
        />
      )}
      {medicineDialog}
      {dialog}
    </div>
  );
}
