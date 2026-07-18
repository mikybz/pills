# Pills 💊

A super-simple, installable web app for manually logging medicine intake.
**Open it — you'll know in one second whether you took your pill, and logging takes two taps.**

English + Norwegian · PWA (install on phone/PC) · yellow/red overdose warnings · history & statistics · Authentik SSO.

See [PLAN.md](PLAN.md) for the full product design and the safety-algorithm specification.

## Features

- **2-tap logging** — one card per medicine with big preset-dose buttons.
- **Safety warnings** — a linear dose-budget model turns buttons yellow/red when a dose
  would be too early or exceed your per-intake / per-day max, with a "next OK from …" hint.
  The app warns but never blocks — reality wins.
- **"Not sure I took it"** — log an uncertain dose; counted in the safety math by default.
- **Backdated logging, skipped doses, notes, undo.**
- **Today ribbon** — per-medicine daily total vs. max with a progress bar.
- **History** — 3-day/week dose timelines, month/year/all aggregates, per-medicine filter,
  edit/delete, CSV/JSON export.
- **Personalization** — colors per medicine, strictness (slack), wake window, language, theme.
- **Help & onboarding** — contextual help sheet, first-run guide, medical disclaimer.

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

Run the safety-model tests:

```bash
npx vitest run
```

## Deployment (Dokploy)

1. Build from the included `Dockerfile` (Next standalone output; migrations run on start).
2. Mount a volume at `/app/data` and set `DATABASE_URL=file:/app/data/pills.db`.
3. Set `AUTH_SECRET`, `AUTH_URL=https://pills.valensendstad.no`, `AUTH_TRUST_HOST=true`
   and the three `AUTH_AUTHENTIK_*` variables (see `.env.example`).
4. In Authentik, create an OAuth2 provider + application with redirect URI
   `https://pills.valensendstad.no/api/auth/callback/authentik`.
5. Point the domain at the container (Traefik + Let's Encrypt via Dokploy);
   health check: `GET /api/health`.

## Disclaimer

This app is a logging aid, **not medical advice**. Always follow your prescription and
your doctor's instructions.
