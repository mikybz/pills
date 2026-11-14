"use client";

// A short two-note chime made with Web Audio (no sound file). Browsers only
// allow audio after the user has interacted with the page, so the context is
// created and resumed on the first tap or key press.
import { useSyncExternalStore } from "react";

const KEY = "pills.liveSound";
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/** Call once on mount: unlocks audio on the first user gesture. */
export function unlockAudioOnGesture() {
  const unlock = () => {
    void context()?.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  return unlock;
}

export function playChime() {
  const ac = context();
  if (!ac || ac.state !== "running") return;
  const start = ac.currentTime + 0.01;
  [
    { freq: 880, at: 0 },
    { freq: 1318.5, at: 0.14 },
  ].forEach(({ freq, at }) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start + at);
    gain.gain.exponentialRampToValueAtTime(0.18, start + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.6);
    osc.connect(gain).connect(ac.destination);
    osc.start(start + at);
    osc.stop(start + at + 0.65);
  });
}

/* ------------------------------------------- per-device on/off (default on) */

export function liveSoundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setLiveSound(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // private mode etc.
  }
  listeners.forEach((l) => l());
  if (on) {
    void context()?.resume().then(playChime).catch(() => {});
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function useLiveSound(): boolean {
  return useSyncExternalStore(subscribe, liveSoundOn, () => true);
}
