"use client";

import { useSyncExternalStore } from "react";

// One shared clock for the UI: re-evaluates every minute (on the minute) and
// whenever the app comes back into focus, so rows move between sections
// without a reload.
let current = typeof window === "undefined" ? 0 : Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  current = Date.now();
  for (const l of listeners) l();
}

function schedule() {
  timer = setTimeout(() => {
    emit();
    schedule();
  }, 60_000 - (Date.now() % 60_000) + 50);
}

function onVisible() {
  if (document.visibilityState === "visible") emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) {
    schedule();
    window.addEventListener("focus", emit);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size) {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", emit);
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current, () => 0);
}

/** Force a re-evaluation (e.g. right after logging). */
export function refreshNow() {
  emit();
}
