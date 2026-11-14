"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, CircleHelp, Minus } from "lucide-react";
import { initials, usePersons } from "@/components/person-context";
import { liveSoundOn, playChime, unlockAudioOnGesture } from "@/lib/chime";
import { formatWhen } from "@/lib/format";
import { loggedDetail, loggedLines, type LoggedBatch } from "@/lib/live-text";
import type { LiveBatch, LiveEvent } from "@/lib/live";
import { cn } from "@/lib/utils";

/** A change for one person (or `null` = refetch everything, after a dropped connection). */
export type LiveChange = { personId: string | null; type: LiveEvent["type"] | "resync" };
type Listener = (change: LiveChange) => void;

interface LiveContextValue {
  subscribe: (fn: Listener) => () => void;
  /** Dose ids someone else just logged for the current person (highlighted briefly). */
  recent: ReadonlySet<string>;
}

const LiveContext = createContext<LiveContextValue | null>(null);

const NOTE_MS = 6000;
/** Back from the background after this long: refetch, events may have been missed. */
const STALE_AFTER_MS = 30_000;
/** A stream the server closed (e.g. 401 after the session expired): try again after this. */
const RETRY_CLOSED_MS = 30_000;

interface Note {
  key: string;
  by: string;
  batch: LoggedBatch;
  lines: string[];
  detail: string;
  status: "taken" | "uncertain" | "skipped";
}

function toBatch(b: LiveBatch): LoggedBatch {
  return {
    ...b,
    items: b.items.map((i) => ({
      ...i,
      takenAt: Date.parse(i.takenAt),
      slotAt: i.slotAt === null ? null : Date.parse(i.slotAt),
    })),
  };
}

/**
 * One EventSource per tab (`GET /api/events`). Screens refetch through
 * `useLiveRefresh`; a dose someone else logs for the person on screen shows a
 * short overlay ("Anna gave Rex Apoquel") with a chime, for another person a
 * quiet toast with "Show".
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const { current, persons, meId, reload: reloadPersons, setCurrentId } = usePersons();
  const listeners = useRef(new Set<Listener>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [notes, setNotes] = useState<Note[]>([]);
  const [recent, setRecent] = useState<ReadonlySet<string>>(new Set());

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);
  const emit = useCallback((change: LiveChange) => listeners.current.forEach((fn) => fn(change)), []);

  const dismiss = useCallback((key: string) => {
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    setNotes((ns) => ns.filter((n) => n.key !== key));
  }, []);

  const announce = useEffectEvent((incoming: LoggedBatch) => {
    if (!meId) return;
    const person = persons.find((p) => p.id === incoming.person.id);
    const timeZone = person?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = Date.now();

    if (incoming.person.id !== current?.id) {
      const lines = loggedLines(t, locale, incoming, meId);
      toast(lines.join("\n"), {
        description: loggedDetail(t, locale, incoming.items[0], now, timeZone),
        action: { label: t("live.show"), onClick: () => setCurrentId(incoming.person.id) },
      });
      return;
    }

    // Several doses from the same person within a few seconds read as one note.
    const key = `${incoming.by.id}|${incoming.person.id}`;
    setNotes((ns) => {
      const prev = ns.find((n) => n.key === key);
      const seen = new Set(prev?.batch.items.map((i) => i.doseId));
      const batch = { ...incoming, items: [...(prev?.batch.items ?? []), ...incoming.items.filter((i) => !seen.has(i.doseId))] };
      const note: Note = {
        key,
        by: incoming.by.name,
        batch,
        lines: loggedLines(t, locale, batch, meId),
        detail:
          batch.items.length === 1
            ? loggedDetail(t, locale, batch.items[0], now, timeZone)
            : formatWhen(batch.items[batch.items.length - 1].takenAt, now, locale, timeZone, t),
        status: batch.items.every((i) => i.status === "skipped")
          ? "skipped"
          : batch.items.some((i) => i.status === "uncertain")
            ? "uncertain"
            : "taken",
      };
      return prev ? ns.map((n) => (n.key === key ? note : n)) : [...ns, note].slice(-3);
    });
    clearTimeout(timers.current.get(key));
    timers.current.set(
      key,
      setTimeout(() => dismiss(key), NOTE_MS),
    );

    const ids = incoming.items.map((i) => i.doseId);
    setRecent((r) => new Set([...r, ...ids]));
    setTimeout(() => setRecent((r) => new Set([...r].filter((id) => !ids.includes(id)))), NOTE_MS);

    if (liveSoundOn()) playChime();
  });

  /** Someone undid a dose: take it out of the note. */
  const retract = useEffectEvent((doseId: string) => {
    setNotes((ns) =>
      ns.flatMap((n) => {
        if (!n.batch.items.some((i) => i.doseId === doseId)) return [n];
        const items = n.batch.items.filter((i) => i.doseId !== doseId);
        if (!items.length) return [];
        const batch = { ...n.batch, items };
        return [{ ...n, batch, lines: meId ? loggedLines(t, locale, batch, meId) : n.lines }];
      }),
    );
  });

  const onEvent = useEffectEvent((ev: LiveEvent) => {
    if (ev.type === "person") void reloadPersons().catch(() => {});
    emit({ personId: ev.personId, type: ev.type });
    if (ev.type !== "doses" || ev.byUserId === meId) return;
    if (ev.action === "created") announce(toBatch(ev.batch));
    else if (ev.action === "deleted") retract(ev.doseId);
  });

  const resync = useEffectEvent(() => {
    void reloadPersons().catch(() => {});
    emit({ personId: null, type: "resync" });
  });

  useEffect(() => {
    const unlock = unlockAudioOnGesture();
    let es: EventSource | null = null;
    let dropped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let hiddenAt = 0;

    const connect = () => {
      es = new EventSource("/api/events");
      es.onopen = () => {
        if (dropped) resync();
        dropped = false;
      };
      es.onerror = () => {
        dropped = true;
        // The browser reconnects by itself unless the server refused the stream.
        if (es?.readyState === EventSource.CLOSED) {
          es.close();
          retry = setTimeout(connect, RETRY_CLOSED_MS);
        }
      };
      es.onmessage = (m) => {
        try {
          onEvent(JSON.parse(m.data) as LiveEvent);
        } catch {
          // ignore malformed events
        }
      };
    };
    connect();

    const onVisibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > STALE_AFTER_MS) resync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const pending = timers.current;
    return () => {
      es?.close();
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      pending.forEach(clearTimeout);
    };
  }, []);

  const value = useMemo(() => ({ subscribe, recent }), [subscribe, recent]);

  return (
    <LiveContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 px-4"
      >
        {notes.map((n) => (
          <button
            key={n.key}
            type="button"
            onClick={() => dismiss(n.key)}
            aria-label={`${n.lines.join(". ")}. ${t("live.dismiss")}`}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border bg-background/95 p-3 text-left shadow-lg backdrop-blur duration-300 animate-in fade-in zoom-in-95 slide-in-from-top-4"
          >
            <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-semibold uppercase text-white">
              {initials(n.by)}
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 flex size-4.5 items-center justify-center rounded-full border-2 border-background",
                  n.status === "taken" ? "bg-teal-600 text-white" : "bg-muted text-muted-foreground",
                )}
              >
                {n.status === "taken" ? (
                  <Check className="size-2.5" strokeWidth={3} />
                ) : n.status === "skipped" ? (
                  <Minus className="size-2.5" strokeWidth={3} />
                ) : (
                  <CircleHelp className="size-2.5" strokeWidth={3} />
                )}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              {n.lines.map((l) => (
                <span key={l} className="block font-medium leading-snug">
                  {l}
                </span>
              ))}
              <span className="block text-xs text-muted-foreground">{n.detail}</span>
            </span>
          </button>
        ))}
      </div>
    </LiveContext.Provider>
  );
}

function useLive() {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used inside LiveProvider");
  return ctx;
}

/** Calls `onChange` (debounced) when something changes for `personId`, or after a reconnect. */
export function useLiveRefresh(personId: string | undefined, onChange: () => void) {
  const { subscribe } = useLive();
  const run = useEffectEvent(onChange);
  useEffect(() => {
    if (!personId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribe((c) => {
      if (c.personId !== null && c.personId !== personId) return;
      clearTimeout(timer);
      timer = setTimeout(run, 250);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [personId, subscribe]);
}

/** Dose ids someone else just logged (for a brief highlight). */
export function useRecentlyLogged() {
  return useLive().recent;
}
