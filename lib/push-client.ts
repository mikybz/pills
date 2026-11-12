"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/client";

/**
 * - supported: can subscribe here.
 * - ios-install: iPhone/iPad in the browser; push needs the home-screen app.
 * - unsupported: no service worker / PushManager / Notification.
 */
export type PushSupport = "supported" | "ios-install" | "unsupported";

export function detectPushSupport(): PushSupport {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIOS && !standalone) return "ios-install";
  return capable ? "supported" : "unsupported";
}

const noop = () => () => {};

/** null until known (server render / hydration). */
export function usePushSupport(): PushSupport | null {
  return useSyncExternalStore(noop, detectPushSupport, () => null);
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
}

export type DeviceState = "unknown" | "on" | "off" | "denied";

async function readState(): Promise<DeviceState> {
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Subscribe this device: ask permission, subscribe with the server's VAPID key, save. */
export async function enablePush(): Promise<DeviceState> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const { publicKey } = await api<{ publicKey: string | null }>("/api/push/config");
  if (!publicKey) throw new Error("push_not_configured");
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await api("/api/push/subscription", { method: "POST", body: JSON.stringify(sub.toJSON()) });
  return "on";
}

export async function disablePush(): Promise<DeviceState> {
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api("/api/push/subscription", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe();
  }
  return "off";
}

/** This device's subscription state (only meaningful when support is "supported"). */
export function useDevicePush(support: PushSupport | null) {
  const [state, setState] = useState<DeviceState>("unknown");
  useEffect(() => {
    if (support !== "supported") return;
    let alive = true;
    readState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState("off"));
    return () => {
      alive = false;
    };
  }, [support]);
  const enable = useCallback(async () => setState(await enablePush()), []);
  const disable = useCallback(async () => setState(await disablePush()), []);
  return { state, enable, disable };
}

/**
 * Re-sends an existing subscription so the server has it for the signed-in
 * user (e.g. after the server dropped it, or a different user signed in).
 */
export async function syncPushSubscription() {
  if (detectPushSupport() !== "supported" || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await api("/api/push/subscription", { method: "POST", body: JSON.stringify(sub.toJSON()) });
}

interface NotificationItem {
  medicineId: string;
  slotAt: string;
}

/** Close our own notifications whose slots are all logged now. */
export async function closeStaleNotifications(isLogged: (medicineId: string, slotAt: number) => boolean) {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  for (const n of await reg.getNotifications()) {
    const items = (n.data as { items?: NotificationItem[] } | null)?.items;
    if (items?.length && items.every((i) => isLogged(i.medicineId, Date.parse(i.slotAt)))) n.close();
  }
}
