/**
 * Reminder scheduler: a 60-second tick inside the Next server (single container,
 * SQLite). All timing lives in the pure `reminderEvents()`; this file only does
 * I/O: load, insert ReminderLog (the unique key makes sending idempotent), send.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pushConfigured, sendToUser } from "@/lib/push";
import { reminderPayload, type ReminderItem } from "@/lib/reminder-text";
import { DAY, MIN, isFinished, reminderEvents, type ReminderEvent } from "@/lib/schedule";
import { currentScheduleFrom, doseAmountOf, scheduleOf, toLogEntries } from "@/lib/types";

const TICK_MS = 60_000;
/** After a restart, look back at most this far so downtime doesn't cause a burst. */
const MAX_LOOKBACK_MS = 5 * MIN;
const PRUNE_AFTER_MS = 7 * DAY;
export const SNOOZE_MS = 30 * MIN;

type State = { timer: ReturnType<typeof setInterval> | null; last: number; running: boolean; lastPrune: number };
const g = globalThis as unknown as { __pillsReminders?: State };

export function startReminderScheduler() {
  if (g.__pillsReminders) return; // guard against double start (dev reloads, HMR)
  const state: State = { timer: null, last: Date.now() - MAX_LOOKBACK_MS, running: false, lastPrune: 0 };
  g.__pillsReminders = state;
  if (!pushConfigured()) {
    console.warn("[reminders] VAPID keys not set — reminders are disabled");
  }
  state.timer = setInterval(() => void tick(state), TICK_MS);
  // Don't keep the process alive just for the timer.
  (state.timer as { unref?: () => void }).unref?.();
  setTimeout(() => void tick(state), 5_000);
}

async function tick(state: State) {
  if (state.running) return;
  state.running = true;
  const now = Date.now();
  const from = Math.max(state.last, now - MAX_LOOKBACK_MS);
  try {
    if (pushConfigured()) await runReminders(from, now);
    state.last = now;
    if (now - state.lastPrune > 3_600_000) {
      state.lastPrune = now;
      await prisma.reminderLog.deleteMany({ where: { sentAt: { lt: new Date(now - PRUNE_AFTER_MS) } } });
    }
  } catch (e) {
    console.error("[reminders] tick failed", e);
  } finally {
    state.running = false;
  }
}

interface Pending {
  userId: string;
  locale: string;
  leadMin: number;
  person: { id: string; name: string; timezone: string; selfOfUserId: string | null };
  item: ReminderItem;
  ev: ReminderEvent;
}

/** Sends every reminder falling in (from, to]. Exported for manual runs / tests. */
export async function runReminders(from: number, to: number) {
  const recipientFilter = {
    reminders: true,
    user: { remindersOn: true, pushSubscriptions: { some: {} } },
  };
  const medicines = await prisma.medicine.findMany({
    where: {
      mode: { in: ["fixed", "interval"] },
      archivedAt: null,
      hidden: false,
      remindersEnabled: true,
      scheduleReviewedAt: { not: null },
      person: { access: { some: recipientFilter } },
    },
    include: {
      person: {
        include: { access: { where: recipientFilter, include: { user: true } } },
      },
    },
  });

  const pending: Pending[] = [];
  const since = new Date(to - 3 * DAY);
  for (const m of medicines) {
    const schedule = scheduleOf(m, m.person);
    if (isFinished(schedule, to)) continue;
    const [doses, snoozeRows] = await Promise.all([
      prisma.doseLog.findMany({
        where: { medicineId: m.id, OR: [{ takenAt: { gte: since } }, { slotAt: { gte: since } }] },
      }),
      prisma.reminderLog.findMany({
        where: { medicineId: m.id, kind: "snooze", slotAt: { gte: since } },
      }),
    ]);
    const logs = toLogEntries(doses, m);
    for (const access of m.person.access) {
      const u = access.user;
      const events = reminderEvents({
        schedule,
        logs,
        anchor: (m.scheduleReviewedAt ?? m.createdAt).getTime(),
        remindFrom: currentScheduleFrom(m),
        settings: { leadMin: u.remindLeadMin, nagEveryMin: u.nagEveryMin, nagMaxMin: u.nagMaxMin },
        snoozes: snoozeRows
          .filter((r) => r.userId === u.id && r.until)
          .map((r) => ({ slotAt: r.slotAt.getTime(), until: r.until!.getTime(), seq: r.seq })),
        from,
        to,
      });
      for (const ev of events) {
        pending.push({
          userId: u.id,
          locale: u.locale,
          leadMin: u.remindLeadMin,
          person: m.person,
          item: {
            medicineId: m.id,
            name: m.name,
            amount: doseAmountOf(m),
            unit: m.unit,
            form: m.form,
            slotAt: ev.slotAt,
          },
          ev,
        });
      }
    }
  }

  // One notification per user, person, instant and kind.
  const groups = new Map<string, Pending[]>();
  for (const p of pending) {
    const key = `${p.userId}|${p.person.id}|${p.ev.at}|${p.ev.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  for (const group of groups.values()) {
    const fresh: Pending[] = [];
    for (const p of group) {
      try {
        await prisma.reminderLog.create({
          data: {
            medicineId: p.item.medicineId,
            slotAt: new Date(p.ev.slotAt),
            userId: p.userId,
            kind: p.ev.kind,
            seq: p.ev.seq,
          },
        });
        fresh.push(p);
      } catch (e) {
        // Unique violation: already sent (e.g. before a restart).
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      }
    }
    if (!fresh.length) continue;
    const first = fresh[0];
    await sendToUser(
      first.userId,
      reminderPayload({
        locale: first.locale,
        kind: first.ev.kind,
        person: first.person,
        forOther: first.person.selfOfUserId !== first.userId,
        effectiveAt: first.ev.effectiveAt,
        leadMin: first.leadMin,
        items: fresh.map((p) => p.item),
      }),
    );
  }
}
