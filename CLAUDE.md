@AGENTS.md

# Pills — medicine logging PWA

Personal medicine-intake logger. Product spec and safety-algorithm design live in
**PLAN.md** — read it before changing behavior.

## Commands

- `npm run dev` — dev server (set `AUTH_DEV_BYPASS=true` in `.env` to skip login)
- `npm run build` / `npm run lint`
- `npx vitest run` — unit tests (safety model)
- `npx prisma migrate dev` — apply/create migrations (SQLite)

## Architecture

- **`lib/safety.ts`** — the core. Pure, I/O-free dose-safety model (green/yellow/red +
  next-OK time), used identically client-side (live button colors) and server-side
  (`POST /api/doses`, `GET /api/safety/:id`). Tested in `lib/safety.test.ts`; keep it pure
  and keep the tests passing.
- **API** — route handlers under `app/api/*`, authenticated via `withUser()` in
  `lib/api.ts`. Data is scoped by **person** (see below), not by user: always go through
  the access helpers in `lib/persons.ts` (`resolvePersonId`, `findAccessibleMedicine`,
  `findAccessibleDose`). PATCH routes must pass parsed bodies through `onlySent()` —
  zod's `.partial()` still applies `.default()`s and would reset untouched fields. Zod schemas in `lib/schemas.ts`. `Medicine.presets`/`scheduleHints` are
  JSON strings (SQLite has no JSON column type).
- **Auth** — Auth.js v5 in `lib/auth.ts`: Authentik OIDC in production, `AUTH_DEV_BYPASS`
  dev user locally. `currentUser()` upserts the DB user; page guard in `app/(app)/layout.tsx`.
- **UI** — screens are client components in `components/*-screen.tsx`, thin server pages in
  `app/(app)/`. shadcn/ui here wraps **Base UI, not Radix** — there is no `asChild`; use
  `render={...}` or `buttonVariants()` + Link.
- **Persons & sharing** — medicines belong to a `Person` (user's undeletable self, other
  people, pets). `PersonAccess` rows grant access; everyone with access can edit, only the
  creator can delete (never a self person). One-time share codes (`ShareToken`, SHA-256
  hashed, 24 h) are redeemed at `POST /api/persons/join`. Client-side current person lives
  in `components/person-context.tsx` (session-scoped; app start opens
  `User.defaultPersonId`). `DoseLog.userId` = who logged it.
- **i18n** — next-intl, no locale routing; locale from the `locale` cookie
  (`i18n/request.ts`). ALL user-visible strings go through `messages/en.json` + `nb.json` —
  add keys to both.
- **Medicine colors** — fixed categorical palette in `lib/types.ts` (`colorClasses`),
  validated for colorblind separation; add new colors only with validated hexes, and keep
  Tailwind class names static (no string interpolation).

## Conventions

- Doses have `status`: `taken | uncertain | skipped`. Uncertain counts in safety math by
  default (user setting); skipped never counts.
- Never hard-delete a medicine with logged doses — archive it (`archivedAt`).
- The app warns on dangerous doses but never blocks logging.
- Times are stored UTC, rolling 24 h windows (not calendar days) for daily limits.
