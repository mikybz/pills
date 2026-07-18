# Pills — Personal Medicine Logging App

A super-simple, modern web app for manually logging medicine intake. The core promise:
**"Did I take my pill? Open the app — you'll know in one second, and logging takes two taps."**

Target: 1–5 medicines per user, installable as a PWA on phone/PC, English + Norwegian,
deployed on valensendstad.no behind Authentik SSO.

---

## 1. Core user flows

### 1.1 Log a dose (the 2-tap happy path)
1. Open the app (PWA icon on home screen).
2. Home screen shows one card per medicine with big preset-dose buttons
   (e.g. `0.5 mg` `1 mg` `2 mg`).
3. Tap a preset → dose is logged **now** with a subtle confirmation (undo toast, 8 s).

Before logging, the safety algorithm evaluates the dose. Buttons are *color-hinted live*:
- **Green/neutral** — fine to take.
- **Yellow** — soft warning; tapping shows a confirm sheet ("You're a bit early / this is
  above your usual dose — take anyway?").
- **Red** — hard warning; tapping shows a strong confirm sheet with explanation and the
  time when it becomes OK. User can still log it (we never block — reality wins over the
  app), but must confirm explicitly.

### 1.2 Custom amount / custom time
Each medicine card has a `⋯` (more) button opening a sheet with:
- **Custom amount** — numeric stepper + free input.
- **Taken earlier** — datetime picker (defaults to now, quick chips: "-15 min", "-1 h",
  "-2 h", "this morning").
- **Not sure I took it** — logs an *uncertain* dose (flagged, shown hatched/faded in
  history, excluded or included in safety math per user setting — default: included,
  safest assumption).
- **Skipped dose** — explicitly record that a scheduled dose was intentionally skipped.
- **Note** — optional free-text note on the dose (e.g. "headache", "before flight").

### 1.3 See what happened (glanceability)
The home screen answers "did I take it?" without any tap:
- Each medicine card shows **"Last taken: 2 h ago (1 mg)"** and a mini 24-h timeline dots
  strip.
- **Next dose hint**: "Next OK from 14:30" / "OK now" computed from the safety algorithm.
- A **Today** ribbon at the top: total per medicine today vs. max per day
  (e.g. `2 / 3 mg` with a progress bar that turns yellow near the max).

### 1.4 History & statistics
A **History** tab with timescale switcher: `3 days · Week · Month · Year · All`.
- **3 days / Week**: horizontal time axis, one lane per medicine, each dose a dot sized
  by amount, tap a dot for details/edit/delete. Uncertain doses hatched.
- **Month**: calendar heat map (per-day total vs. max/day) + daily totals bar chart.
- **Year / All**: weekly/monthly aggregate bars, adherence/usage trend line.
- Every view filterable per medicine.
- **Export**: CSV / JSON download of the log (for doctors or backup).

### 1.5 Manage medicines
Settings → Medicines: create/edit/archive (never hard-delete while logs exist).
Per medicine:
- Name, form (pill, tablet, capsule, spray, drops, injection, liquid, other), strength
  unit (mg, µg, g, ml, IU, puffs, pieces), color + icon (for instant recognition).
- **Preset doses** (1–4 quick buttons, e.g. 0.5 / 1 / 2 mg) and default preset.
- **Max per intake** (optional), **Max per day** (optional) → drives the safety algorithm.
- Optional **minimum interval override** (if the doctor said "at least X hours apart",
  that beats the computed interval).
- Optional **daily schedule hints** (e.g. "morning + evening") used for the "suggested
  next time" and future reminders.
- Notes field (free text, e.g. prescription info).

---

## 2. The safety algorithm (yellow/red warnings)

Inputs per medicine: `maxPerIntake` (M_i), `maxPerDay` (M_d), optional
`minIntervalOverride`, and the rolling log.

**Idea:** if you may take at most `M_d` per rolling 24 h, then a dose of `a` "occupies"
`a / M_d × 24 h` of budget. Linear model with slack.

Definitions (rolling 24-hour window, not calendar day, to avoid midnight abuse):
- `used24 = Σ amounts in last 24 h` (uncertain doses count by default).
- `budgetLeft = M_d − used24`.
- **Required spacing** for a dose of amount `a`:
  `requiredGap(a) = (a / M_d) × 24 h × (1 − slack)` where `slack = 0.15` by default
  (user-tunable "strictness" setting: relaxed 0.25 / normal 0.15 / strict 0).
  Example: M_i = 1 mg, M_d = 3 mg → full dose gap = 8 h × 0.85 ≈ 6.8 h… but the user's
  example expects ~3.5 h for 1 mg with 3 mg/day. So the spacing is computed against the
  *whole day's* dosing capacity: with `M_d / M_i = 3` intakes across the waking window.
  We therefore use the **wake window** `W` (default 17 h, configurable, e.g. 07–24):
  `requiredGap(a) = (a / M_d) × W × (1 − slack)`.
  With W = 17 h, slack 0.15: 1 mg → 17/3 × 0.85 ≈ **4.8 h**; 0.5 mg → **2.4 h**.
  With W = 14 h it's ≈ 4.0/2.0 h. (The 3.5 h in the idea sits in this range; W and slack
  are user-tunable per profile.)
- Effectively each past dose "releases" budget linearly: dose `a_k` taken at `t_k` still
  occupies `a_k × max(0, 1 − (now − t_k)/requiredGap(a_k))` of "recent load".
  `recentLoad = Σ occupied` and a new dose `a` is:
  - **RED** if `a > M_i` (with slack: `a > M_i × 1.10`) — hard per-intake breach, or
    `used24 + a > M_d` — would exceed the 24 h max.
  - **YELLOW** if `a > M_i` but ≤ `M_i × 1.10`, or `recentLoad + a > M_i` (i.e. taking it
    now effectively means more than one full intake "active"), or
    `used24 + a > M_d × 0.85` (approaching the daily ceiling).
  - **GREEN** otherwise.
- If `minIntervalOverride` is set, RED when `now − lastDose < override × 0.9`,
  YELLOW when `< override`.
- **Next-OK time**: smallest `t` where the default preset dose would be GREEN — shown on
  the card ("Next OK from 14:30") and used for the suggested-next-time hint.

All thresholds live in one pure TypeScript module (`lib/safety.ts`) with unit tests, so
the model is easy to tune.

**Disclaimer** shown in Help/first-run: this is a logging aid, not medical advice; always
follow prescription and doctor's instructions.

---

## 3. Screens & navigation

Bottom tab bar (mobile-first), max 3 tabs + header:

| Tab | Content |
|-----|---------|
| **Home** (log) | Today ribbon, medicine cards with preset buttons, last-taken + next-OK, mini 24 h dots |
| **History** | Timescale switcher, timeline/calendar/aggregate charts, dose list with edit/delete, export |
| **Settings** | Medicines CRUD, profile (language, theme, strictness, wake window, uncertain-dose policy), help, about, logout |

Header: app logo, date, language flag toggle, help `?` button (contextual help sheet per
screen). Dark/light theme follows system with manual override.

Design language: modern, calm, rounded cards, big touch targets (min 48 px), Tailwind +
shadcn/ui, subtle motion (logged-dose checkmark animation). Medicine color coding
throughout (card accent, chart series, dots).

---

## 4. Data model (Prisma / SQLite)

```prisma
model User {
  id        String   @id            // Authentik `sub`
  email     String   @unique
  name      String?
  locale    String   @default("en") // "en" | "nb"
  theme     String   @default("system")
  strictness Float   @default(0.15) // slack
  wakeWindowH Float  @default(17)
  countUncertain Boolean @default(true)
  medicines Medicine[]
  doses     DoseLog[]
  createdAt DateTime @default(now())
}

model Medicine {
  id        String  @id @default(cuid())
  userId    String
  user      User    @relation(...)
  name      String
  form      String  @default("pill")   // pill|capsule|spray|drops|injection|liquid|other
  unit      String  @default("mg")
  color     String  @default("blue")
  icon      String  @default("pill")
  presets   Json                        // number[] e.g. [0.5, 1, 2]
  defaultPreset Float?
  maxPerIntake  Float?
  maxPerDay     Float?
  minIntervalMin Int?                   // optional override, minutes
  scheduleHints Json?                   // ["08:00","20:00"]
  notes     String?
  sortOrder Int     @default(0)
  archivedAt DateTime?
  doses     DoseLog[]
}

model DoseLog {
  id        String   @id @default(cuid())
  userId    String
  medicineId String
  amount    Float
  takenAt   DateTime                    // may be backdated
  status    String   @default("taken")  // taken | uncertain | skipped
  note      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

SQLite file on a Dokploy volume; Prisma migrations. All queries scoped by `userId`.

## 5. API (Next.js route handlers, all under `/api`)

- `GET/POST /api/medicines`, `PATCH/DELETE /api/medicines/:id` (delete = archive)
- `GET /api/doses?from&to&medicineId` · `POST /api/doses` · `PATCH/DELETE /api/doses/:id`
- `GET /api/safety/:medicineId?amount=` → {level, reasons, nextOkAt} (same pure lib used client-side; server is source of truth on write)
- `GET/PATCH /api/profile`
- `GET /api/export?format=csv|json`

## 6. Auth

- **Auth.js (NextAuth v5)** with a generic OIDC provider pointed at Authentik
  (`AUTH_AUTHENTIK_ISSUER`, `AUTH_AUTHENTIK_ID`, `AUTH_AUTHENTIK_SECRET`).
- User row auto-created on first login from the OIDC profile (email/name/sub).
- `AUTH_DEV_BYPASS=true` env for local dev → fixed dev user, no IdP needed.
- Middleware protects everything except `/api/health` and static assets.

## 7. i18n

- `next-intl` with `en` and `nb` message catalogs; locale stored on the user profile
  (and cookie for pre-login). Flag/label toggle in header. All dates via `Intl` with
  locale + 24 h clock for `nb`.

## 8. Help

- `?` in the header opens a contextual help sheet for the current screen.
- Settings → Help: full guide (getting started, safety colors explained with examples,
  FAQ "I'm not sure I took it", export, install-as-app instructions per platform).
- First-run onboarding: 3 short cards (add medicine → tap to log → colors explained)
  + medical disclaimer.

## 9. PWA & deployment

- `manifest.webmanifest`, icons, `standalone` display, theme color; installable on
  iOS/Android/desktop. Simple service worker for shell caching (read-only offline view
  of cached data; logging requires network in v1 — offline queue is a v2 feature).
- **Dockerfile** (Next standalone output) + healthcheck; deployed via Dokploy on the
  Hostinger VPS, domain `pills.valensendstad.no` (Traefik + Let's Encrypt), SQLite on a
  mounted volume, env vars for Authentik OIDC.

## 10. Nice-to-have backlog (not v1)

Reminders/notifications at suggested times · offline logging queue · multi-profile
(carer logs for family member) · medication stock/refill countdown · doctor report PDF ·
Apple/Google Health export · med interaction warnings · widgets.

## 11. Implementation steps (each = commit)

1. `PLAN.md` (this file).
2. Scaffold: Next.js App Router + TS + Tailwind + shadcn/ui + base layout/theme.
3. Prisma schema + SQLite + seed; profile/medicine/dose API routes; `lib/safety.ts` + unit tests.
4. Home screen: medicine cards, preset logging, custom sheet (amount/time/uncertain/skip), undo, today ribbon, next-OK.
5. History: timescales, timeline + calendar + aggregates, edit/delete, export.
6. Settings: medicines CRUD, profile prefs; i18n en/nb; help system + onboarding.
7. Auth.js + Authentik OIDC (+ dev bypass); middleware.
8. PWA (manifest/SW/icons), Dockerfile, README.md, CLAUDE.md, deploy notes.
