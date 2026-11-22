/**
 * Reminder scheduler: a 60-second tick inside the Next server (single container,
 * SQLite). All timing lives in the pure `reminderEvents()`; this file only does
 * I/O: load, insert ReminderLog (the unique key makes sending idempotent), send.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pushConfigured, sendToUser } from "@/lib/push";
import { careOpen, careReminderEvents } from "@/lib/care";
import {
  carePayload,
  careTag,
  closePayload,
  reminderPayload,
  reminderTag,
  type CareItem,
  type ReminderItem,
} from "@/lib/reminder-text";
import { DAY, MIN, isFinished, reminderEvents, spanDays, type ReminderEvent } from "@/lib/schedule";
import { currentScheduleFrom, doseAmountOf, kindOf, scheduleOf, toLogEntries } from "@/lib/types";

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

interface Recipient {
  userId: string;
  locale: string;
  leadMin: number;
  /** Reminders stop this long after a slot (with the lead: how far back "open" reaches). */
  windowMin: number;
}

interface Entry {
  recipient: Recipient;
  person: { id: string; name: string; timezone: string; selfOfUserId: string | null };
  /** Reminder events falling in (from, to]: what makes this tick send. */
  events: { medicineId: string; slotAt: number; kind: string; seq: number }[];
  /** Every slot still unanswered and being reminded about at `to`. */
  open: ReminderItem[];
}

/**
 * Per user and person: events in (from, to] and the slots still open at `to`.
 * Open = a reminder event happened in the last lead + repeat window, the slot has no
 * log, is not snoozed (snoozed events are withheld) and is before its cutoff.
 */
async function collect(from: number, to: number, personId?: string): Promise<Entry[]> {
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
      ...(personId ? { personId } : {}),
      person: { access: { some: recipientFilter } },
    },
    include: {
      person: {
        include: { access: { where: recipientFilter, include: { user: true } } },
      },
    },
  });

  const entries = new Map<string, Entry>();
  for (const m of medicines) {
    const schedule = scheduleOf(m, m.person);
    const finished = isFinished(schedule, to);
    // Weekly / every-N-days doses: logs back to the previous scheduled day.
    const since = new Date(to - (spanDays(schedule) + 2) * DAY);
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
      const key = `${u.id}|${m.person.id}`;
      const entry = entries.get(key) ?? {
        recipient: { userId: u.id, locale: u.locale, leadMin: u.remindLeadMin, windowMin: u.remindLeadMin + u.nagMaxMin },
        person: m.person,
        events: [],
        open: [],
      };
      entries.set(key, entry);
      if (finished) continue;
      const args = {
        schedule,
        logs,
        anchor: (m.scheduleReviewedAt ?? m.createdAt).getTime(),
        remindFrom: currentScheduleFrom(m),
        settings: { leadMin: u.remindLeadMin, nagEveryMin: u.nagEveryMin, nagMaxMin: u.nagMaxMin },
        snoozes: snoozeRows
          .filter((r) => r.userId === u.id && r.until)
          .map((r) => ({ slotAt: r.slotAt.getTime(), until: r.until!.getTime(), seq: r.seq })),
        to,
      };
      for (const ev of reminderEvents({ ...args, from })) {
        entry.events.push({ medicineId: m.id, slotAt: ev.slotAt, kind: ev.kind, seq: ev.seq });
      }
      // The latest event per slot decides the wording of its line.
      const latest = new Map<number, ReminderEvent>();
      const lookback = to - (entry.recipient.windowMin + 1) * MIN;
      for (const ev of reminderEvents({ ...args, from: lookback })) latest.set(ev.slotAt, ev);
      for (const ev of latest.values()) {
        if (ev.cutoff <= to) continue;
        entry.open.push({
          medicineId: m.id,
          name: m.name,
          amount: doseAmountOf(m),
          unit: m.unit,
          form: m.form,
          itemKind: kindOf(m),
          slotAt: ev.slotAt,
          effectiveAt: ev.effectiveAt,
          kind: ev.kind,
        });
      }
    }
  }
  return [...entries.values()];
}

interface CareEntry {
  recipient: { userId: string; locale: string; remindTime: string };
  person: { id: string; name: string; timezone: string; selfOfUserId: string | null };
  /** Nudges falling in (from, to]. */
  events: { medicineId: string; cycleAt: number; seq: number }[];
  /** Every care item due and already nudged at `to`. */
  open: CareItem[];
}

/**
 * Care schedules (tasks, to-dos, measurements with flex / once): per user and
 * person, the daily nudges in (from, to] and the items open at `to`. Same
 * recipients as dose reminders.
 */
async function collectCare(from: number, to: number, personId?: string): Promise<CareEntry[]> {
  const recipientFilter = {
    reminders: true,
    user: { remindersOn: true, pushSubscriptions: { some: {} } },
  };
  const items = await prisma.medicine.findMany({
    where: {
      mode: { in: ["flex", "once"] },
      archivedAt: null,
      hidden: false,
      remindersEnabled: true,
      scheduleReviewedAt: { not: null },
      ...(personId ? { personId } : {}),
      person: { access: { some: recipientFilter } },
    },
    include: {
      person: { include: { access: { where: recipientFilter, include: { user: true } } } },
      doses: { orderBy: { takenAt: "desc" }, take: 1, select: { takenAt: true } },
    },
  });
  const entries = new Map<string, CareEntry>();
  for (const m of items) {
    const schedule = scheduleOf(m, m.person);
    if (isFinished(schedule, to)) continue;
    const lastAt = m.doses[0]?.takenAt.getTime() ?? null;
    const anchor = (m.scheduleReviewedAt ?? m.createdAt).getTime();
    for (const access of m.person.access) {
      const u = access.user;
      const key = `${u.id}|${m.person.id}`;
      const entry = entries.get(key) ?? {
        recipient: { userId: u.id, locale: u.locale, remindTime: u.careRemindTime },
        person: m.person,
        events: [],
        open: [],
      };
      entries.set(key, entry);
      const args = { schedule, lastAt, anchor, remindTime: u.careRemindTime };
      for (const ev of careReminderEvents({ ...args, from, to })) {
        entry.events.push({ medicineId: m.id, cycleAt: ev.cycleAt, seq: ev.seq });
      }
      const st = careOpen({ ...args, to });
      if (st) {
        entry.open.push({
          medicineId: m.id,
          name: m.name,
          itemKind: kindOf(m),
          state: st.state,
          daysLeft: st.daysLeft,
          dueAt: st.dueAt,
          cycleAt: st.cycleAt,
        });
      }
    }
  }
  return [...entries.values()];
}

function carePayloadFor(entry: CareEntry, now: number, update = false) {
  return carePayload({
    locale: entry.recipient.locale,
    person: entry.person,
    forOther: entry.person.selfOfUserId !== entry.recipient.userId,
    items: entry.open,
    now,
    update,
  });
}

/** Inserts the ReminderLog rows; true when at least one was new (not sent before). */
async function claim(rows: { medicineId: string; slotAt: number; userId: string; kind: string; seq: number }[]) {
  let fresh = false;
  for (const r of rows) {
    try {
      await prisma.reminderLog.create({ data: { ...r, slotAt: new Date(r.slotAt) } });
      fresh = true;
    } catch (e) {
      // Unique violation: already sent (e.g. before a restart).
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  return fresh;
}

function payloadFor(entry: Entry, update = false) {
  return reminderPayload({
    locale: entry.recipient.locale,
    person: entry.person,
    forOther: entry.person.selfOfUserId !== entry.recipient.userId,
    leadMin: entry.recipient.leadMin,
    items: entry.open,
    update,
  });
}

/** Sends every reminder falling in (from, to]. Exported for manual runs / tests. */
export async function runReminders(from: number, to: number) {
  for (const entry of await collect(from, to)) {
    if (!entry.events.length) continue;
    const fresh = await claim(entry.events.map((ev) => ({ ...ev, userId: entry.recipient.userId })));
    // One notification per person: everything open, so it replaces the last one.
    if (fresh && entry.open.length) await sendToUser(entry.recipient.userId, payloadFor(entry));
  }
  // Tasks and to-dos: their own notification per person, nudged once a day.
  for (const entry of await collectCare(from, to)) {
    if (!entry.events.length) continue;
    const fresh = await claim(
      entry.events.map((ev) => ({
        medicineId: ev.medicineId,
        slotAt: ev.cycleAt,
        userId: entry.recipient.userId,
        kind: "care",
        seq: ev.seq,
      })),
    );
    if (fresh && entry.open.length) await sendToUser(entry.recipient.userId, carePayloadFor(entry, to), 12 * 3600);
  }
}

/**
 * After doses changed for a person: bring each device's reminder notification in
 * line. Nothing open → close it; fewer slots open → replace it quietly. Only for
 * users who were sent a reminder for this person recently, so a log with nothing
 * on screen costs no push.
 *
 * `fromEndpoint` = the device that logged last (it closed its own notification
 * already). It gets no "close": a push that ends with nothing on screen makes
 * Chrome show its own "tap to copy the URL" notification instead.
 */
export async function syncReminderNotifications(
  personId: string,
  now = Date.now(),
  fromEndpoint?: string | null,
  /** Which notifications the changed logs belong to (default both). */
  groups: ReadonlySet<"doses" | "care"> = new Set(["doses", "care"]),
) {
  if (!pushConfigured()) return;
  const [entries, careEntries] = await Promise.all([
    groups.has("doses") ? collect(now, now, personId) : [],
    groups.has("care") ? collectCare(now, now, personId) : [],
  ]);
  if (!entries.length && !careEntries.length) return;
  const userIds = [...entries, ...careEntries].map((e) => e.recipient.userId);
  const recent = await prisma.reminderLog.findMany({
    where: { userId: { in: userIds }, kind: { not: "snooze" }, sentAt: { gte: new Date(now - DAY - 5 * MIN) } },
    select: { userId: true, kind: true, sentAt: true, medicine: { select: { personId: true } } },
  });
  const sentSince = (userId: string, care: boolean, since: number) =>
    recent.some(
      (l) =>
        l.userId === userId &&
        (l.kind === "care") === care &&
        l.medicine.personId === personId &&
        l.sentAt.getTime() >= since,
    );
  for (const entry of entries) {
    const r = entry.recipient;
    if (!sentSince(r.userId, false, now - (r.windowMin + 5) * MIN)) continue;
    if (entry.open.length) await sendToUser(r.userId, payloadFor(entry, true));
    else await sendToUser(r.userId, closePayload(r.locale, reminderTag(personId)), undefined, fromEndpoint);
  }
  // The care notification stays up to a day (one nudge a day).
  for (const entry of careEntries) {
    const r = entry.recipient;
    if (!sentSince(r.userId, true, now - DAY - 5 * MIN)) continue;
    if (entry.open.length) await sendToUser(r.userId, carePayloadFor(entry, now, true), 12 * 3600);
    else await sendToUser(r.userId, closePayload(r.locale, careTag(personId)), undefined, fromEndpoint);
  }
}
