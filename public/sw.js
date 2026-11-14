// App-shell service worker: caches static assets (network-first for pages),
// shows reminder notifications and handles their Taken / Snooze actions, and
// shows "Anna gave Rex …" notices (kind "logged").
// Logging always needs the network; nothing is queued offline.
const CACHE = "pills-v2";
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
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: data.data || { url: "/" },
      actions: data.actions || [],
    });
  e.waitUntil(data.kind === "logged" ? onLogged(data, show) : show());
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
  const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (!mustShow && wins.some((w) => w.focused && w.visibilityState === "visible")) return;
  await show();
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
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
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
