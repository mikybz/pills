import webpush from "web-push";
import { prisma } from "@/lib/db";

// Read through a variable so Next does not inline NEXT_PUBLIC_* at build time:
// the keys come from the runtime environment (Dokploy), not the build.
const env = process.env;

export function vapidPublicKey(): string | null {
  return env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

let configured = false;

/** True when all three VAPID variables are set (and web-push is configured). */
export function pushConfigured(): boolean {
  const pub = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return false;
  if (!configured) {
    webpush.setVapidDetails(subject, pub, priv);
    configured = true;
  }
  return true;
}

export interface PushPayload {
  /** "logged" = someone else logged a dose (see `lib/live.ts`); reminders leave it out. */
  kind?: "logged";
  title: string;
  body: string;
  tag: string;
  renotify?: boolean;
  actions?: { action: string; title: string }[];
  data?: unknown;
}

/**
 * Sends to every subscription of a user. Subscriptions the push service reports
 * as gone (404 / 410) are deleted.
 */
export async function sendToUser(userId: string, payload: PushPayload, ttlSeconds = 1800) {
  if (!pushConfigured()) return { sent: 0, failed: 0 };
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: ttlSeconds, urgency: "high" },
        );
        sent++;
      } catch (e) {
        failed++;
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.deleteMany({ where: { id: s.id } });
        } else {
          console.error("[push] send failed", status ?? e);
        }
      }
    }),
  );
  return { sent, failed };
}
