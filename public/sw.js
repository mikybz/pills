// App-shell service worker: caches static assets (network-first for pages),
// shows reminder notifications and handles their Taken / Snooze actions, and
// shows "Anna gave Rex …" notices (kind "logged"), and keeps one reminder per person
// in step with the doses logged anywhere (kinds "update" / "close").
// Logging always needs the network; nothing is queued offline.
// The cache is named after the app version (layout.tsx registers /sw.js?v=<version>):
// a deploy installs a new worker, and `activate` deletes the old build's cache.
const CACHE = `pills-${new URL(self.location.href).searchParams.get("v") || "dev"}`;
const SHELL = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m ?? Response.error())),
  );
});

/* ---------------------------------------------------------------- push */

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: "Pills", body: e.data ? e.data.text() : "" };
  }
  const show = () =>
    self.registration.showNotification(data.title || "Pills", {
      body: data.body || "",
      tag: data.tag,
      renotify: Boolean(data.tag && data.renotify),
      silent: Boolean(data.silent),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: data.data || { url: "/" },
      actions: data.actions || [],
    });
  e.waitUntil(
    data.kind === "logged"
      ? onLogged(data, show)
      : data.kind === "close" || data.kind === "update"
        ? onSync(data, show)
        : show(),
  );
});

// Safari revokes push subscriptions that receive a push without a notification.
const mustShow = /iPhone|iPad|Macintosh/.test(self.navigator.userAgent) && !/Chrome|Chromium|Firefox|Edg\//.test(self.navigator.userAgent);

/** Someone else logged a dose: close the reminders it answered, then notify. */
async function onLogged(data, show) {
  const logged = (data.data && data.data.logged) || [];
  const answered = (i) => logged.some((l) => l.medicineId === i.medicineId && l.slotAt === i.slotAt);
  for (const n of await self.registration.getNotifications()) {
    const items = n.data && n.data.items;
    if (Array.isArray(items) && items.length && items.every(answered)) n.close();
  }
  // An open, focused app already showed it live (overlay + chime).
  if (!mustShow && (await appVisible())) return;
  await show();
}

async function appVisible() {
  const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return wins.some((w) => w.focused && w.visibilityState === "visible");
}

/**
 * The server brought a person's reminder up to date after doses were logged (here,
 * on another device, or by someone else). "update" replaces the notification in
 * place (quietly showing it again if it was swiped away: doses are still open);
 * "close" removes it. Chrome shows its own "tap to copy the URL" notification when a
 * push leaves nothing on screen (a flash-and-close does not count), so the server
 * sends no "close" to the device that logged the dose; it closed its own already.
 * Safari revokes the subscription instead, so there we still flash one.
 */
async function onSync(data, show) {
  if (data.kind === "update") return show();
  const existing = await self.registration.getNotifications({ tag: data.tag });
  if (mustShow) {
    await self.registration.showNotification(data.title || "Pills", { tag: data.tag, silent: true, icon: "/icon-192.png" });
    for (const n of await self.registration.getNotifications({ tag: data.tag })) n.close();
    return;
  }
  for (const n of existing) n.close();
}

async function openApp(url = "/") {
  const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const w of wins) {
    if (new URL(w.url).origin === self.location.origin && "focus" in w) {
      await w.navigate(url).catch(() => {});
      return w.focus();
    }
  }
  return self.clients.openWindow(url);
}

async function tellWindows() {
  const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const w of wins) w.postMessage({ type: "doses-changed" });
}

async function post(path, body) {
  // Our endpoint: the server then sends this device no "close" (we closed it here).
  const sub = await self.registration.pushManager.getSubscription().catch(() => null);
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(sub ? { "X-Push-Endpoint": sub.endpoint } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(String(res.status));
}

self.addEventListener("notificationclick", (e) => {
  const n = e.notification;
  const data = n.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  n.close();

  if (e.action === "taken" && items.length) {
    // Same-origin fetch: the session cookie is sent. On 401 or any failure, open
    // the app instead — never queue silently.
    e.waitUntil(
      (async () => {
        try {
          const takenAt = new Date().toISOString();
          for (const it of items) {
            await post("/api/doses", {
              medicineId: it.medicineId,
              amount: it.amount,
              slotAt: it.slotAt,
              takenAt,
              status: "taken",
            });
          }
          await tellWindows();
        } catch {
          await openApp("/");
        }
      })(),
    );
    return;
  }

  if (e.action === "snooze" && items.length) {
    e.waitUntil(
      post("/api/reminders/snooze", { items: items.map((i) => ({ medicineId: i.medicineId, slotAt: i.slotAt })) }).catch(
        () => openApp("/"),
      ),
    );
    return;
  }

  e.waitUntil(openApp(data.url || "/"));
});
