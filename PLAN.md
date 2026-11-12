# Pills — Personal Medicine Logging App

A super-simple, modern web app that reminds people to take their medicine and records that
they did — including people who forget easily (ADHD). The core promise:
**"What do I take now, and did I take it? Open the app — you'll know in one second."**

Target: 1–5 medicines per user, installable as a PWA on phone/PC, English + Norwegian,
deployed on valensendstad.no behind Authentik SSO.

---

## 1. Core user flows

> Sections 1.1–1.3, 1.5 and 2 were rewritten on 2026-11-12 (schedules + reminders). The
> design notes behind them are in REWRITE.md.

### 1.1 Today's checklist (home)
The home screen is a checklist for today, ordered by time:
- **Due now** — due and overdue slots, oldest first, including yesterday's overdue slots
  until their cutoff. Overdue rows say "1 h 20 min late". One tap on **Take** logs it now,
  with an 8-second undo toast.
- **Missed** — only when a slot passed its cutoff today: **Take late anyway** / **Skip**.
- **Later today** — upcoming slots until local midnight; tapping offers **Take now (early)**.
- **Done** — today's taken / skipped logs with the actual time (tap to edit).
- **As needed** — one card per as-needed medicine: quick-dose buttons, last intake, and the
  limit as facts ("2 of 3 used · next free at 14:30").
- A pushed slot shows its effective time with the original struck through. "All done for
  today" when nothing is left. The list re-evaluates every minute and on focus.

### 1.2 The ⋯ log sheet
Every row's `⋯` opens the log sheet: custom amount, **taken earlier** (chips −15 min /
−1 h / −2 h or a date + 24 h time field), **not sure I took it** (uncertain), **skipped**,
and a note.

### 1.3 Warnings
One confirm sheet, one level. It states the fact ("You took it at 08:05 (40 min ago)") and
offers **Log anyway** / **Cancel**. The app never blocks logging. See §2.4.

### 1.4 History & statistics
A **History** tab with timescale switcher: `3 days · Week · Month · Year · All`.
- **3 days / Week**: horizontal time axis, one lane per medicine, each dose a dot sized
  by amount, tap a dot for details/edit/delete. Uncertain doses hatched.
- **Month**: calendar heat map (per-day total vs. max/day) + daily totals bar chart.
- **Year / All**: weekly/monthly aggregate bars, adherence/usage trend line.
- Every view filterable per medicine.
- **Export**: CSV / JSON download of the log (for doctors or backup).

### 1.5 Manage medicines
Settings → Medicines: create / edit / archive (never hard-delete while logs exist).
The add form is simple-first: **name**, **how often?** (Once / Twice / 3 times / 4 times a
day · Every … hours · As needed), **dose** (default `1` tablet). Times-a-day chips create
fixed times (08:00 · 08:00, 20:00 · 07:00, 15:00, 23:00 · 06:00, 12:00, 18:00, 00:00), all
editable; changing the first offers to shift the others. "Every … hours" asks for the hours
and **At fixed times** (recommended; when 24 divides evenly) or **Count from when I last
took it** (interval). Night-time doses (23:00–06:00) get a plain hint.
**More options**: course length (N days / end date), reminders on/off, minimum gap (hours),
color, form, presets + max per intake (as needed), notes. Editing a schedule applies from
now on; history keeps the old schedule (`ScheduleVersion`).

Existing medicines (before schedules) get an auto-guessed schedule on first open
(`POST /api/persons/:id/migrate`), confirmed per medicine on a one-time review screen
(then a banner until done). Unconfirmed medicines send no reminders and derive no missed
doses.

---

## 2. Scheduling, warnings and reminders

All timing lives in pure modules (`lib/schedule.ts`, `lib/safety.ts`, `lib/tz.ts`) used by
the client, the API and the reminder tick alike.

### 2.1 Modes
| Mode | Stored as | Next dose is |
|---|---|---|
| `fixed` | `times: ["08:00","20:00"]`, wall clock in `Person.timezone` | the next clock time |
| `interval` | `intervalH: 8` | last intake + interval (a skip advances from its `slotAt`) |
| `asNeeded` | optional `maxPerDay`, `minIntervalMin`, `maxPerIntake` | no schedule |

Scheduled medicines have one `doseAmount`. Optional `startsOn` / `endsOn` (local dates,
inclusive) give a course length; a finished medicine leaves the checklist and can be
archived from Settings.

### 2.2 Fixed slots
- A slot is identified by its UTC instant `slotAt`; `DoseLog.slotAt` records which slot a
  log answers (server-assigned when the client doesn't pick a row).
- `minGap` = `minIntervalMin` if set, else half the gap to the next slot. Cutoff =
  `nextSlotAt − minGap`: 08:00 + 20:00 can be taken until 14:00; once daily until 20:00.
- States: upcoming → due (from `slotAt − heads-up`) → overdue → **missed** after the
  cutoff; taken / skipped when a log fills it (uncertain fills it too). Missed slots are
  derived, never stored, and only from `scheduleReviewedAt` onward.
- Late doses don't move the schedule. **Push rule:** a dose taken at `t` moves only the
  next slot to `max(nextSlotAt, t + minGap)`.
- A tap fills the oldest due/overdue slot, else the next slot (early, next one only). A
  backdated log fills the slot whose window contains it — unless that would make it an
  early dose for a slot on a later day (then it answers the previous open slot as a late
  dose, or no slot). A missed slot is filled only from its row or a backdated time.
- DST: a nonexistent time moves to the next valid minute; a repeated time gives one slot.

### 2.3 Interval mode
Next due = last taken + `intervalH`; the first dose is due right away (or at `startsOn`).
No missed state: an unlogged dose stays overdue and reminders stop after the repeat limit.

### 2.4 Dose check (`checkDose`)
- Scheduled: warn only when the slot already has a taken/uncertain log, or the previous
  dose is less than `minGap` ago. No daily-max math.
- As needed: warn when the amount exceeds `maxPerIntake`, the last dose is less than
  `minIntervalMin` ago, or the total over the **limit window** plus this dose exceeds
  `maxPerDay`. Limit window = 24 h − 4 h slack = 20 h (`AS_NEEDED_SLACK_H`), so getting up
  earlier than yesterday doesn't warn. `countUncertain` (user setting) only affects these.
- The server repeats the check on `POST /api/doses` with fresh data; if it finds a double
  dose the client didn't know about, the toast says so (with Undo).

### 2.5 Reminders (web push)
- For each slot of a reviewed medicine with reminders on (and not finished), to each user
  with `User.remindersOn`, `PersonAccess.reminders` for that person, and a subscription:
  heads-up `remindLeadMin` before (default 10), at the time, then every `nagEveryMin`
  (15) until `nagMaxMin` (120) or the cutoff. Uses the effective (pushed) time.
- Nothing once the slot has any log by anyone. Same person + same instant ⇒ one
  notification (tag `personId:slotAt`). Other people / pets are prefixed ("Rex: …"). Text
  in the receiving user's language.
- Actions: **Taken** (SW posts the dose; on failure opens the app — nothing is queued),
  **Snooze 30 min** (per user; one more reminder when it ends). iOS shows no actions.
- Engine: 60 s tick from `instrumentation.ts`; each send first inserts a `ReminderLog` row
  (unique key ⇒ idempotent); look back at most 5 min after a restart; prune after 7 days.
  Subscriptions answering 404/410 are deleted. No quiet hours.
- Settings hide everything a device can't use; iPhone/iPad outside the home-screen app
  counts as unsupported and gets install steps.

### 2.6 Required unit tests
In `lib/schedule.test.ts` / `lib/safety.test.ts`: (1) once daily 08:00 taken at 08:00, no
warning, day 1 and after; (2) 09:30 yesterday + 08:00 today, no warning; (3) backdated
yesterday-evening dose doesn't change today or warn; (4) 08/20 taken at 10:00 keeps 20:00;
(5) morning slot overdue at 13:59, missed at 14:00; (6) missed morning taken at 16:00 pushes
the next to 22:00, then back on the clock; (7) second tap on a logged slot warns;
(8) interval 8 h: 09:10 → 17:10, skip advances from `slotAt`; (9) as needed max 3: 08, 14,
20 then 06:00 ok, a fourth at 23:00 warns; (10) DST both ways in Europe/Oslo; (11) `endsOn`
yesterday ⇒ no slots today; (12) reminder events: heads-up, due, repeats, none after a
log, none during a snooze, pushed slot uses the effective time.

**Disclaimer** shown in Help/first-run: this is a reminder and logging aid, not medical
advice; always follow prescription and doctor's instructions.

---

## 3. Screens & navigation

Bottom tab bar (mobile-first), max 3 tabs + header:

| Tab | Content |
|-----|---------|
| **Today** | Today's checklist (due now / missed / later / done) and as-needed cards |
| **History** | Summary line, timeline with missed markers / month calendar / monthly adherence bars, day list with missed doses, export |
| **Settings** | People & pets, medicines, reminders, preferences (language, theme, uncertain-dose policy), help, logout |

Header: app logo, date, language flag toggle, help `?` button (contextual help sheet per
screen). Dark/light theme follows system with manual override.

Design language: modern, calm, rounded cards, big touch targets (min 48 px), Tailwind +
shadcn/ui, 24-hour clock everywhere. Medicine color coding
throughout (card accent, chart series, dots).

---

## 4. Data model (Prisma / SQLite)

See `prisma/schema.prisma` (source of truth). Main tables: `User` (preferences, reminder
settings), `Person` (+ `timezone`), `PersonAccess` (+ `reminders`), `ShareToken`,
`Medicine` (mode, doseAmount, times JSON, intervalH, startsOn/endsOn, remindersEnabled,
scheduleReviewedAt, scheduleChangedAt, presets, limits), `ScheduleVersion` (past
schedules for history), `DoseLog` (takenAt, `slotAt`, status, note, logged-by user),
`PushSubscription`, `ReminderLog`. Times stored UTC; JSON stored as strings.

## 5. API (Next.js route handlers, all under `/api`)

- `GET/POST /api/medicines`, `PATCH/DELETE /api/medicines/:id` (delete = archive), `PUT /api/medicines/reorder`
- `GET /api/doses?from&to&medicineId&personId` · `POST /api/doses` (optional `slotAt`; returns `{dose, check}`) · `PATCH/DELETE /api/doses/:id` (time change re-assigns `slotAt`)
- `GET/PATCH /api/profile`
- `GET/POST /api/persons`, `PATCH/DELETE /api/persons/:id`, `PATCH /api/persons/:id/access` (my reminders), `POST /api/persons/:id/share`, `POST /api/persons/join`, `DELETE /api/persons/:id/members/:userId`
- `POST /api/persons/:id/migrate` (guess schedules) · `POST /api/persons/:id/review` (confirm)
- `GET /api/push/config` · `POST/DELETE /api/push/subscription` · `POST /api/push/test` · `POST /api/reminders/snooze`
- `GET /api/export?format=csv|json` (incl. `slot_at`, `mode`, and missed slots as `missed` rows)

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
- Help sheet: getting started, today's list, late doses, the double-dose check, as-needed
  limits, reminders, "I'm not sure I took it", past doses, install-as-app.
- First-run onboarding: 3 short cards (add medicines → check off today's list → reminders)
  + medical disclaimer.

## 9. PWA & deployment

- `manifest.webmanifest`, icons, `standalone` display, theme color; installable on
  iOS/Android/desktop. Simple service worker for shell caching (read-only offline view
  of cached data; logging requires network — offline queue is a later feature). The service
  worker also shows reminder notifications (§2.5).
- **Dockerfile** (Next standalone output) + healthcheck; deployed via Dokploy on the
  Hostinger VPS, domain `pills.valensendstad.no` (Traefik + Let's Encrypt), SQLite on a
  mounted volume, env vars for Authentik OIDC.

## 10. Nice-to-have backlog (not v1)

Different dose amounts per slot · weekday / every-N-days schedules · quiet hours · offline logging queue · multi-profile
(carer logs for family member) · medication stock/refill tracking · doctor report PDF ·
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

---

## Persons, pets & sharing (added 2026-11)

Track medicine for more than the signed-in user — family members, dogs, other animals —
and share tracking between users.

**Model**
- `Person` (name, `kind`: person | dog | cat | other). Every user gets an undeletable
  *self* person (`selfOfUserId`) created on first request. Users can create more persons
  (`createdById` = creator).
- `PersonAccess` (personId, userId) — who can see/edit a person. Creator/self always has
  access; sharing adds rows.
- `Medicine.personId` replaces `Medicine.userId`. Doses keep `userId`, now meaning
  *logged by* (shown in history when someone else logged it).
- `User.defaultPersonId` — which person the app opens on. Falls back to self.
- `ShareToken` — one-time code (stored as SHA-256 hash), expires after 24 h, consumed on
  first use.

**Rules**
- Anyone with access can do everything (medicines, doses, rename) **except delete**.
- Only the creator can delete a created person (cascades medicines + doses). A self
  person can never be deleted.
- Any user with access can generate a share code. A recipient redeems it in Settings →
  People → "Add with code" (or via the `/settings?join=CODE` link).
- A user can leave a person shared with them; the creator / self-owner can remove others.
- Shared persons show a "shared" badge + avatars of the other users in the switcher and
  in Settings → People.

**UI**
- Person switcher in the header (current person name + kind icon). Selection is kept for
  the browser session (sessionStorage); a fresh start opens the default person.
- Settings → People: list, create, rename, set default, share (code + copy link), leave,
  delete, add-with-code.
- Preferences (count-uncertain, reminder settings) stay per *user* (viewer). Reminders are
  opt-in per person (`PersonAccess.reminders`): on for yourself, off for others; a dose
  logged by anyone stops reminders for everyone.
