"use client";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { APP_VERSION, CHECK_VERSION_EVENT, blockReload, reloadBlocked } from "@/lib/version";

/**
 * Keeps open pages on the deployed version. A tab or installed app left open (for days,
 * on a phone) checks /api/version when it comes back to the front, when the network
 * returns, when the live stream reconnects (a deploy restarts the server), and every
 * 5 minutes while visible. A newer version → reload, unless a dialog is open
 * (`useBlockReload`), then a "Reload" toast. After the reload: "Updated to <version>".
 * Next's deploymentId (next.config.ts) covers navigations on top of this.
 * Standard: new-app skill `references/versioning.md`.
 */

const UPDATED_KEY = "pills.updated";
/** The version a reload last tried to reach: never reload twice for the same one (a stale cache would loop). */
const TRIED_KEY = "pills.update-tried";
const EVERY_MS = 5 * 60_000;
const MIN_GAP_MS = 30_000;
const WAITING_TOAST = "pills-update-waiting";

function session(fn: (s: Storage) => string | null | void) {
  try {
    return fn(sessionStorage) ?? null;
  } catch {
    return null;
  }
}

function reload() {
  session((s) => s.setItem(UPDATED_KEY, "1"));
  location.reload();
}

/** Blocks the automatic reload while the calling component is mounted (and `active`). */
export function useBlockReload(active = true) {
  useEffect(() => (active ? blockReload() : undefined), [active]);
}

export function UpdateCheck() {
  const t = useTranslations("update");

  useEffect(() => {
    // The reload that just happened, if any.
    if (session((s) => s.getItem(UPDATED_KEY))) {
      session((s) => s.removeItem(UPDATED_KEY));
      toast(t("updated", { version: APP_VERSION }));
    }
    if (session((s) => s.getItem(TRIED_KEY)) === APP_VERSION) session((s) => s.removeItem(TRIED_KEY));
  }, [t]);

  useEffect(() => {
    if (APP_VERSION === "dev") return;
    let last = 0;
    const check = async (force = false) => {
      if (document.visibilityState !== "visible" || (!force && Date.now() - last < MIN_GAP_MS)) return;
      last = Date.now();
      const version = await fetch("/api/version", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { version?: string } | null) => b?.version)
        .catch(() => undefined);
      if (!version || version === APP_VERSION) return;
      const tried = session((s) => s.getItem(TRIED_KEY)) === version;
      if (tried) console.warn(`still on ${APP_VERSION} after reloading for ${version}`);
      if (tried || reloadBlocked()) {
        toast(t("ready"), {
          id: WAITING_TOAST,
          duration: Infinity,
          action: { label: t("reload"), onClick: reload },
        });
        return;
      }
      session((s) => s.setItem(TRIED_KEY, version));
      reload();
    };
    const onVisible = () => void check();
    const onReconnect = () => void check(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener(CHECK_VERSION_EVENT, onReconnect);
    const timer = setInterval(onVisible, EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener(CHECK_VERSION_EVENT, onReconnect);
      clearInterval(timer);
    };
  }, [t]);

  return null;
}
