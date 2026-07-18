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
- **API** — route handlers under `app/api/*`, all scoped by user via `withUser()` in
  `lib/api.ts`. Zod schemas in `lib/schemas.ts`. `Medicine.presets`/`scheduleHints` are
  JSON strings (SQLite has no JSON column type).
- **Auth** — Auth.js v5 in `lib/auth.ts`: Authentik OIDC in production, `AUTH_DEV_BYPASS`
  dev user locally. `currentUser()` upserts the DB user; page guard in `app/(app)/layout.tsx`.
- **UI** — screens are client components in `components/*-screen.tsx`, thin server pages in
  `app/(app)/`. shadcn/ui here wraps **Base UI, not Radix** — there is no `asChild`; use
  `render={...}` or `buttonVariants()` + Link.
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
