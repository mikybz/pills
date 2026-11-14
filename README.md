# Pills 💊

A super-simple, installable web app that reminds you to take your medicine and records that you did.
**Open it — you see what's due now and whether you took it, and logging takes one tap.**

English + Norwegian · PWA (install on phone/PC) · schedules & web-push reminders · history & statistics · Authentik SSO.

See [PLAN.md](PLAN.md) for the product design (scheduling model, dose check, reminders) and
[REWRITE.md](REWRITE.md) for the reasoning behind the schedule/reminder rewrite.

## Features

- **Schedules** — once / twice / 3 / 4 times a day, every N hours (fixed times or counted
  from the last dose), or as needed. Course length, 24-hour clock everywhere. Suggested
  times stay inside each person's usual day (default 07:00–23:00); medicines can be marked
  "also at night". Pills, creams and more (creams are *applied*).
- **Today's checklist** — due now, missed, later today, done; as-needed cards with limits.
  A late dose moves only the next one a little (half an hour per hour late, never past
  bedtime), then the day is back on the clock.
- **Reminders** — web push: heads-up, at the time, repeats until logged; Taken / Snooze on
  the notification. Opt-in per person when tracking others; one dose stops it for everyone.
- **Double-dose check** — one confirm sheet when a dose looks like a double; as-needed
  limits over a rolling 20 h window. Warns, never blocks.
- **"Not sure I took it"**, "Log an earlier dose" (a dose from yesterday never fills
  today's), skipped doses, notes, undo.
- **History** — adherence summary, missed doses, timelines, month calendar, export.
- **People & pets** — track for others and share access. Shared lists update live: when
  someone else gives a dose, open apps refresh at once with a chime and a short note
  ("Anna gave Rex Apoquel"); optionally a push notification when the app is closed.

## Stack

Next.js (App Router) · TypeScript · Tailwind 4 · shadcn/ui · Prisma 6 + SQLite ·
Auth.js (Authentik OIDC) · next-intl (en/nb) · Vitest.

## Development

```bash
npm install
cp .env.example .env        # defaults work; set AUTH_DEV_BYPASS=true to skip login
npx prisma migrate dev
npm run dev
```

Reminders locally: put a VAPID key pair (`npx web-push generate-vapid-keys`) and
`VAPID_SUBJECT=mailto:you@example.com` in `.env.local`. Browsers allow push on
`http://localhost`; on another host use `next dev --experimental-https`.

Sharing locally: with `AUTH_DEV_BYPASS=true`, a `devUser=anna` cookie signs that browser in as a
second user ("Anna"); use a separate browser profile or a private window.

Run the unit tests (schedule, day window, drift, dose check, migration guess, reminder and live text):

```bash
npx vitest run
```

## Deployment (Dokploy)

1. Build from the included `Dockerfile` (Next standalone output; migrations run on start).
2. Mount a volume at `/app/data` and set `DATABASE_URL=file:/app/data/pills.db`.
3. Set `AUTH_SECRET`, `AUTH_URL=https://pills.valensendstad.no`, `AUTH_TRUST_HOST=true`
   and the three `AUTH_AUTHENTIK_*` variables (see `.env.example`).
   For reminders also set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
   `VAPID_SUBJECT` (`mailto:…`); generate a key pair once with
   `npx web-push generate-vapid-keys`. They are read at runtime, so no rebuild is needed.
4. In Authentik, create an OAuth2 provider + application with redirect URI
   `https://pills.valensendstad.no/api/auth/callback/authentik`.
5. Point the domain at the container (Traefik + Let's Encrypt via Dokploy);
   health check: `GET /api/health`.

## Disclaimer

This app is a reminder and logging aid, **not medical advice**. Always follow your prescription and
your doctor's instructions.
