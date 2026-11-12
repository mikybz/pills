@AGENTS.md

# Pills — medicine logging PWA

Personal medicine reminder and logger (schedules, today's checklist, web-push reminders).
Product spec lives in **PLAN.md** — read it before changing behavior.

## Commands

- `npm run dev` — dev server (set `AUTH_DEV_BYPASS=true` in `.env` to skip login)
- `npm run build` / `npm run lint`
- `npx vitest run` — unit tests (schedule, dose check, migration guess, timezone math)
- `npx prisma migrate dev` — apply/create migrations (SQLite)

## Architecture

- **`lib/schedule.ts`** — the core. Pure, clock-free scheduling model: three modes
  (`fixed` clock times, `interval`, `asNeeded`), slots identified by their UTC instant
  `slotAt`, slot states (upcoming/due/overdue/missed/taken/skipped), the push rule,
  slot assignment for a tap or a backdated log, reminder events, history slots. Used
  identically by the client (checklist, history), the API (assigns `DoseLog.slotAt` on
  write — the server is the source of truth) and the reminder tick.
- **`lib/safety.ts`** — pure `checkDose()` → `ok | warn` with reasons. Scheduled
  medicines: only likely double doses. As needed: max per intake, min interval, max per
  day over a 20 h window (`AS_NEEDED_SLACK_H`). One confirm sheet, never blocks.
- **`lib/tz.ts`** — Intl-based wall-clock ↔ UTC (DST: nonexistent → next valid minute,
  repeated → first occurrence). Fixed times are wall-clock in `Person.timezone`.
- **`lib/guess.ts`** / `POST /api/persons/:id/migrate` — guesses schedules for medicines
  with `mode = null` (pre-rewrite); users confirm them on the review screen.
- Keep all of the above pure and keep `lib/*.test.ts` passing; every scenario in
  PLAN.md §2.6 has a test in `lib/schedule.test.ts` / `lib/safety.test.ts`.
- **Reminders** — `instrumentation.ts` starts a 60 s tick (`lib/reminders.ts`, I/O only)
  in the Node runtime. Each send inserts a `ReminderLog` row first (unique key ⇒
  idempotent across restarts). `lib/push.ts` wraps `web-push`; VAPID keys come from
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, read at runtime
  (the public key is served by `GET /api/push/config`, not inlined at build).
  `public/sw.js` shows notifications and handles Taken / Snooze. Notification text is
  i18n'd server-side via `lib/reminder-text.ts`.
- **API** — route handlers under `app/api/*`, authenticated via `withUser()` in
  `lib/api.ts`. Data is scoped by **person** (see below), not by user: always go through
  the access helpers in `lib/persons.ts` (`resolvePersonId`, `findAccessibleMedicine`,
  `findAccessibleDose`). PATCH routes must pass parsed bodies through `onlySent()` —
  zod's `.partial()` still applies `.default()`s and would reset untouched fields. Zod schemas in `lib/schemas.ts`. `Medicine.presets`/`times` are
  JSON strings (SQLite has no JSON column type). A schedule edit stores the old one as a
  `ScheduleVersion` and sets `scheduleChangedAt` so history keeps past missed slots.
- **Auth** — Auth.js v5 in `lib/auth.ts`: Authentik OIDC in production, `AUTH_DEV_BYPASS`
  dev user locally. `currentUser()` upserts the DB user; page guard in `app/(app)/layout.tsx`.
- **UI** — screens are client components in `components/*-screen.tsx`, thin server pages in
  `app/(app)/`. Home = today's checklist (`lib/checklist.ts`), re-evaluated every minute
  via `useNow()`. Logging goes through `useDoseLogger` (check → confirm sheet → POST →
  undo toast). Reminder settings are hidden on devices that can't show notifications
  (`usePushSupport()`); only the global switch stays. shadcn/ui here wraps **Base UI, not Radix** — there is no `asChild`; use
  `render={...}` or `buttonVariants()` + Link.
- **Persons & sharing** — medicines belong to a `Person` (user's undeletable self, other
  people, pets). `PersonAccess` rows grant access; everyone with access can edit, only the
  creator can delete (never a self person). One-time share codes (`ShareToken`, SHA-256
  hashed, 24 h) are redeemed at `POST /api/persons/join`. Client-side current person lives
  in `components/person-context.tsx` (session-scoped; app start opens
  `User.defaultPersonId`). `DoseLog.userId` = who logged it. `PersonAccess.reminders` =
  whether that user gets reminders for that person (on for self, off for others).
- **i18n** — next-intl, no locale routing; locale from the `locale` cookie
  (`i18n/request.ts`). ALL user-visible strings go through `messages/en.json` + `nb.json` —
  add keys to both.
- **Medicine colors** — fixed categorical palette in `lib/types.ts` (`colorClasses`),
  validated for colorblind separation; add new colors only with validated hexes, and keep
  Tailwind class names static (no string interpolation).

## Conventions

- Doses have `status`: `taken | uncertain | skipped`. An uncertain log always fills a slot;
  for as-needed limits it counts unless the user turned `countUncertain` off. Skipped
  never counts.
- Never hard-delete a medicine with logged doses — archive it (`archivedAt`).
- The app warns on likely double doses / as-needed limits but never blocks logging.
- Times are stored UTC. Fixed schedule times are wall clock in the person's timezone.
- 24-hour clock everywhere: pass `hourCycle: "h23"` (helpers in `lib/format.ts`). Never use
  native `<input type="time">` / `datetime-local` — use `TimeField` / `DateTimeField`.
- Missed slots are derived, never stored, and only from `scheduleReviewedAt` onward.
- No `setState` synchronously in effects and no `Date.now()` in render (the React lint
  rules reject both): load in an effect with `.then(...)`, use `useNow()` for the clock,
  and mount dialogs only while open so their state starts from props.
