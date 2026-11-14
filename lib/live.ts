/**
 * Live updates (I/O only): an in-process event bus feeding `GET /api/events`
 * (server-sent events), plus the delayed push notice to users who asked to hear
 * when someone else logs. Single container, so no broker is needed; the bus sits
 * on globalThis because route handlers are bundled separately.
 */
import { EventEmitter } from "node:events";
import { prisma } from "@/lib/db";
import { loggedLines, shortName, type LoggedBatch, type LoggedItem, type LoggedStatus } from "@/lib/live-text";
import { pushConfigured, sendToUser } from "@/lib/push";
import { translatorFor } from "@/lib/reminder-text";

/** What the client hears. Sent only to users with access to `personId`. */
export type LiveEvent =
  | { type: "doses"; action: "created"; personId: string; byUserId: string; batch: LiveBatch }
  | { type: "doses"; action: "updated" | "deleted"; personId: string; byUserId: string; doseId: string }
  | { type: "medicines" | "person"; personId: string; byUserId: string };

/** `LoggedBatch` with instants as ISO strings (JSON). */
export type LiveBatch = Omit<LoggedBatch, "items"> & {
  items: (Omit<LoggedItem, "takenAt" | "slotAt"> & { takenAt: string; slotAt: string | null })[];
};

interface Envelope {
  userIds: string[];
  event: LiveEvent;
}

const g = globalThis as unknown as { __pillsLive?: EventEmitter; __pillsNotices?: Map<string, Notice> };

function bus() {
  if (!g.__pillsLive) {
    g.__pillsLive = new EventEmitter();
    g.__pillsLive.setMaxListeners(0);
  }
  return g.__pillsLive;
}

/** Calls `fn` for every event this user may see. Returns the unsubscribe function. */
export function subscribe(userId: string, fn: (event: LiveEvent) => void) {
  const listener = (env: Envelope) => {
    if (env.userIds.includes(userId)) fn(env.event);
  };
  bus().on("event", listener);
  return () => void bus().off("event", listener);
}

/** Fire-and-forget: never fails or delays the write that caused it. */
export function publish(event: LiveEvent) {
  void prisma.personAccess
    .findMany({ where: { personId: event.personId }, select: { userId: true } })
    .then((rows) => bus().emit("event", { userIds: rows.map((r) => r.userId), event } satisfies Envelope))
    .catch((e) => console.error("[live] publish failed", e));
}

type DoseRow = {
  id: string;
  medicineId: string;
  amount: number;
  status: string;
  takenAt: Date;
  slotAt: Date | null;
};

/**
 * A new dose: tell open apps now, and queue the push notice. Call after the row
 * is written.
 */
export async function doseCreated(
  dose: DoseRow,
  by: { id: string; name: string | null; email: string },
  medicine: { name: string; form: string; unit: string; personId: string },
) {
  try {
    const person = await prisma.person.findUnique({
      where: { id: medicine.personId },
      select: { id: true, name: true, selfOfUserId: true },
    });
    if (!person) return;
    const batch: LiveBatch = {
      by: { id: by.id, name: shortName(by.name, by.email) },
      person,
      items: [
        {
          doseId: dose.id,
          medicineId: dose.medicineId,
          medicineName: medicine.name,
          form: medicine.form,
          amount: dose.amount,
          unit: medicine.unit,
          status: dose.status as LoggedStatus,
          takenAt: dose.takenAt.toISOString(),
          slotAt: dose.slotAt?.toISOString() ?? null,
        },
      ],
    };
    publish({ type: "doses", action: "created", personId: person.id, byUserId: by.id, batch });
    queueNotice(person.id, by.id, dose.id);
  } catch (e) {
    console.error("[live] doseCreated failed", e);
  }
}

/* ------------------------------------------------------------ push notice */

/**
 * Waits past the 8-second undo window (an undone dose sends nothing) and
 * gathers the logger's doses for the person in that time into one notification.
 * Pending notices are lost on a restart; open apps already got the live event.
 */
export const NOTICE_DELAY_MS = 10_000;

interface Notice {
  doseIds: Set<string>;
}

function notices() {
  return (g.__pillsNotices ??= new Map());
}

function queueNotice(personId: string, byUserId: string, doseId: string) {
  const key = `${personId}|${byUserId}`;
  const open = notices().get(key);
  if (open) {
    open.doseIds.add(doseId);
    return;
  }
  notices().set(key, { doseIds: new Set([doseId]) });
  const timer = setTimeout(() => {
    const notice = notices().get(key);
    notices().delete(key);
    if (notice) void sendNotice(personId, byUserId, [...notice.doseIds]).catch((e) => console.error("[live] notice failed", e));
  }, NOTICE_DELAY_MS);
  (timer as { unref?: () => void }).unref?.();
}

async function sendNotice(personId: string, byUserId: string, doseIds: string[]) {
  if (!pushConfigured()) return;
  const recipients = await prisma.personAccess.findMany({
    where: {
      personId,
      notifyLogs: true,
      userId: { not: byUserId },
      user: { remindersOn: true, pushSubscriptions: { some: {} } },
    },
    include: { user: { select: { id: true, locale: true } } },
  });
  if (!recipients.length) return;
  // Current state: undone doses are gone, edits (e.g. now skipped) apply.
  const [doses, by, person] = await Promise.all([
    prisma.doseLog.findMany({
      where: { id: { in: doseIds } },
      include: { medicine: { select: { name: true, form: true, unit: true } } },
      orderBy: { takenAt: "asc" },
    }),
    prisma.user.findUnique({ where: { id: byUserId }, select: { id: true, name: true, email: true } }),
    prisma.person.findUnique({ where: { id: personId }, select: { id: true, name: true, selfOfUserId: true } }),
  ]);
  if (!doses.length || !by || !person) return;
  const batch: LoggedBatch = {
    by: { id: by.id, name: shortName(by.name, by.email) },
    person,
    items: doses.map((d) => ({
      doseId: d.id,
      medicineId: d.medicineId,
      medicineName: d.medicine.name,
      form: d.medicine.form,
      amount: d.amount,
      unit: d.medicine.unit,
      status: d.status as LoggedStatus,
      takenAt: d.takenAt.getTime(),
      slotAt: d.slotAt?.getTime() ?? null,
    })),
  };
  for (const r of recipients) {
    const { t, locale } = translatorFor(r.user.locale);
    await sendToUser(
      r.user.id,
      {
        kind: "logged",
        title: t("app.name"),
        body: loggedLines(t, locale, batch, r.user.id).join("\n"),
        tag: `logged:${personId}:${doses[0].id}`,
        data: {
          url: `/?person=${encodeURIComponent(personId)}`,
          personId,
          // The service worker closes reminders these doses answered.
          logged: doses
            .filter((d) => d.slotAt)
            .map((d) => ({ medicineId: d.medicineId, slotAt: d.slotAt!.toISOString() })),
        },
      },
      3600,
    );
  }
}

/** An edited or removed dose (the medicine still exists, so its person is known). */
export function doseChanged(action: "updated" | "deleted", dose: { id: string; medicineId: string }, byUserId: string) {
  void prisma.medicine
    .findUnique({ where: { id: dose.medicineId }, select: { personId: true } })
    .then((m) => m && publish({ type: "doses", action, personId: m.personId, byUserId, doseId: dose.id }))
    .catch((e) => console.error("[live] doseChanged failed", e));
}
