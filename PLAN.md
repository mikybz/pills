# Pills — Personal Medicine Logging App

A super-simple, modern web app that reminds people to take their medicine and records that
they did — including people who forget easily (ADHD). The core promise:
**"What do I take now, and did I take it? Open the app — you'll know in one second."**

Target: 1–5 medicines per user, installable as a PWA on phone/PC, English + Norwegian,
deployed on valensendstad.no behind Authentik SSO.

---

## 1. Core user flows

> Sections 1.1–1.3, 1.5 and 2 were rewritten on 2026-11-12 (schedules + reminders; the
> settled decisions and the migration of old medicines are §12 and §13). On 2026-11-13 they
> gained the day window, late-dose drift, earlier doses and creams (§1.1, §1.2, §1.5, §2.2,
> §2.3, §2.7).

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
- A moved slot shows its effective time with the original struck through and a short
  reason ("Moved 1 h because the last dose was late"; an interval dose due at night is
  "moved to the morning"). "All done for today" when nothing is left. The list
  re-evaluates every minute and on focus.
- **Log an earlier dose** — a quiet button under the list (also in History): pick the
  medicine (skipped with one), then the log sheet opens with no row and the time field
  open. A log for another day says so in its toast ("Logged: Ibux, yesterday 20:00"); a
  log that moved the next dose adds "Next dose moved to 21:00".
- **Night banner** — "Some doses are at night, outside 07:00–23:00 · Review" whenever a
  fixed medicine has a time in the sleep window; opens the night-dose preview (§2.7).
  "Leave for now" hides it for the session.
- Creams say **Apply** / **Apply late anyway** / **Apply now (early)** instead of Take.

### 1.2 The ⋯ log sheet
Every row's `⋯` opens the log sheet: custom amount, **taken earlier** (chips −15 min /
−1 h / −2 h or a date + 24 h time field), **not sure I took it** (uncertain), **skipped**,
and a note. For scheduled medicines, once the time isn't "now", one live line says which
dose it counts as: "Counts as the 20:00 dose yesterday" or "Extra dose. It doesn't count
for any scheduled dose."

A log opened from a row keeps the row's slot only when its time is not before the slot's
window start (and not on an earlier local day than the slot); taps (time ≈ now, e.g.
"Take now (early)") always keep it. Otherwise the window rule assigns the slot (§2.2),
which may be an earlier slot or none — a dose backdated to yesterday from today's row
never fills today's slot. One exception: an earlier time on the row's own day whose window
slot is already taken stays an early dose for the row. Client and server use the same pure
`slotForLog`; the server applies it to every requested slot (stale clients, the service
worker, `PATCH /api/doses/:id`).

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
fixed times inside the person's day window (`spreadTimes`; with 07:00–23:00: 08:00 ·
08:00, 20:00 · 07:00, 15:00, 23:00 · 07:00, 12:30, 17:30, 23:00), or 24 h spacing (06:00,
12:00, 18:00, 00:00 …) when **Also at night** is on; all editable; changing the first
offers to shift the others. "Every … hours" asks for the hours and **At fixed times**
(recommended; when 24 divides evenly) or **Count from when I last took it** (interval).
A fixed time in the sleep window (fixed "every … hours", or typed by hand) gets a hint
naming the window with **Move into my day** (`fitTimes`) and **Keep night doses** (turns
on Also at night). Interval medicines get a note that night doses wait until wake-up.
**More options**: course length (N days / end date), reminders on/off, **Also at night**
(`aroundTheClock`), **Adjust the next dose when I'm late** (drift, fixed mode, on by
default), minimum gap (hours), color, form, presets + max per intake (as needed), notes.
Form **Cream / ointment** ("Salve / krem") uses the unit `appl` ("1 application" /
"2 påsmøringer"); picking it switches `pcs` → `appl`, leaving it switches back. Editing a
schedule applies from now on; history keeps the old schedule (`ScheduleVersion`).

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
- A late dose moves at most the **next** slot (the one directly after the slot it filled,
  taken or uncertain at `t`; skipped and early doses move nothing):
  - **Drift** (when `Medicine.driftEnabled`, default on): `delay = t − previous.slotAt`
    (nominal time, so a dose taken on its drifted time still counts as late); none below
    1 h; `drift = floor(delay / 1 h) × 30 min` (2 h late ⇒ 1 h; 3 h 20 ⇒ 1 h 30). Not across
    the night: none when a wake time lies between the two slots (the first dose of a day
    never drifts) or when the slot's nominal time is in the sleep window. Never past that
    day's bedtime (a bedtime dose never moves); no cap for around-the-clock medicines.
  - **Push rule** (safety floor, may exceed bedtime): `effectiveAt = max(slotAt + drift,
    t + minGap)`.
  - It returns to the clock by itself: 08 / 13 / 18 / 23 with the first dose at 10:00 ⇒
    14:00, taken then ⇒ 18:30, taken then ⇒ 23:00.
- A tap fills the oldest due/overdue slot, else the next slot (early, next one only). A
  backdated log fills the slot whose window contains it — unless that would make it an
  early dose for a slot on a later day (then it answers the previous open slot as a late
  dose, or no slot). A missed slot is filled only from its row or a backdated time.
- DST: a nonexistent time moves to the next valid minute; a repeated time gives one slot.

### 2.3 Interval mode
Next due = last taken + `intervalH`; the first dose is due right away (or at `startsOn`).
No missed state: an unlogged dose stays overdue and reminders stop after the repeat limit.
Unless the medicine is around the clock, a due time in the sleep window keeps its `slotAt`
but is effective (row, reminders) at the next wake time.

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
  (15) until `nagMaxMin` (120) or the cutoff. Uses the effective (drifted / pushed /
  morning) time. Creams read "Time to apply …" / "Smør på …" with an **Applied** action.
- Nothing once the slot has any log by anyone. Same person + same instant ⇒ one
  notification **per person** (tag `reminders:<personId>`): each reminder lists every slot
  of that person still unanswered and replaces the last one, never stacking. One due
  instant reads as a sentence, several as one line per instant ("08:00 Ibux, 1 tablet").
  Other people / pets are prefixed ("Rex: …") or, with several instants, are the title.
  Text in the receiving user's language.
- **Kept in step with the doses** (`syncReminderNotifications`, 10 s after a dose is
  logged, edited or undone, so the undo window passes first): to each user who was sent a
  reminder for that person in the last day, a `close` push when nothing is open any more
  (answered in the app, on another device, or by someone else, whether or not they opted
  into "tell me when…"), or a quiet `update` push with the remaining slots. The service
  worker replaces or closes the notification by tag; if there is none (the user swiped it
  away) it shows a silent one and closes it at once, because browsers want every push to
  show something. An update never brings a dismissed notification back. Logging in the
  app also closes this device's notifications immediately (`closeStaleNotifications`).
- Actions: **Taken** (SW posts the dose; on failure opens the app — nothing is queued),
  **Snooze 30 min** (per user; one more reminder when it ends). iOS shows no actions.
- Engine: 60 s tick from `instrumentation.ts`; each send first inserts a `ReminderLog` row
  (unique key ⇒ idempotent); look back at most 5 min after a restart; prune after 7 days.
  Subscriptions answering 404/410 are deleted. No quiet hours (decided 2026-11-13:
  reminders behave the same at night; the day window only shapes the schedule).
- Settings hide everything a device can't use; iPhone/iPad outside the home-screen app
  counts as unsupported and gets install steps.

### 2.6 Required unit tests
In `lib/schedule.test.ts` / `lib/safety.test.ts`: (1) once daily 08:00 taken at 08:00, no
warning, day 1 and after; (2) 09:30 yesterday + 08:00 today, no warning; (3) backdated
yesterday-evening dose doesn't change today or warn; (4) 08/20 taken at 10:00: next is
21:00 (20:00 with drift off); (5) morning slot overdue at 13:59, missed at 14:00; (6) missed
morning taken at 16:00: next is 23:00 (drift 4 h capped at bedtime; 22:00 with drift off),
then back on the clock; (7) second tap on a logged slot warns; (8) interval 8 h: 09:10 →
17:10, skip advances from `slotAt`; (9) as needed max 3: 08, 14, 20 then 06:00 ok, a fourth
at 23:00 warns; (10) DST both ways in Europe/Oslo; (11) `endsOn` yesterday ⇒ no slots
today; (12) reminder events: heads-up, due, repeats, none after a log, none during a
snooze, pushed slot uses the effective time; (13) a row log backdated to before the slot's
window answers the earlier slot (or none) and today's slot stays open; (14) `spreadTimes`
for 1–6 doses with 07:00–23:00, 09:00–21:00 and a wrapping 15:00–07:00; (15) `fitTimes`:
shift (06/18 → 07/19), single time (23:30 → 23:00), re-spread (06/12/18/00 →
07/12:30/17:30/23), nothing to do ⇒ null; (16) drift: threshold, rounding, cascade back to
the clock, bedtime cap, none over the night, none after a skip, none when disabled, no
clamp around the clock; (17) interval due time in the sleep window ⇒ effective at wake;
(18) reminder events use the drifted effective time; (19) `inSleep` at both window edges
and for a wrapping window.

### 2.7 Day window
- Each person has a usual day: `Person.wakeTime` / `bedTime` ("HH:MM" wall clock in the
  person's time zone, default 07:00–23:00). It may wrap midnight (wake 15:00, bed 07:00);
  awake length = `(bed − wake) mod 24 h`, valid between 6 h and 23 h; both ends count as
  awake (`inSleep`). Set in the person dialog ("Usually awake from … to …"); Settings
  shows a "Day: 07:00–23:00" row for the current person.
- It shapes suggestions and timing, never reminders: times-a-day suggestions
  (`spreadTimes`: step 24 h / N; if the span fits, the first dose up to 1 h after waking,
  else evenly from wake to bed; rounded to 30 min, inside the window), drift (§2.2) and
  interval night doses (§2.3).
- **Night-dose preview** — after saving a changed window, and from the Home banner: every
  active, unfinished, reviewed fixed medicine that is not around the clock and has a time
  in the sleep window, old → new times (`fitTimes`: shift the whole schedule by the
  smallest amount that fits, else re-spread). Per medicine **Move** (default) / **Keep at
  night** (sets `aroundTheClock`) / **Leave for now**. Apply = one `PATCH
  /api/medicines/:id` per changed medicine (normal schedule-edit path). Nothing moves
  silently; no data migration was needed for existing night doses.
- **Also at night** (`Medicine.aroundTheClock`, off by default) ignores the window: 24 h
  spacing, never in the preview, no night hint, drift without the bedtime cap.

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
settings), `Person` (+ `timezone`, `wakeTime`, `bedTime`), `PersonAccess` (+ `reminders`,
`notifyLogs`),
`ShareToken`, `Medicine` (mode, doseAmount, times JSON, intervalH, startsOn/endsOn,
remindersEnabled, `aroundTheClock`, `driftEnabled`, scheduleReviewedAt, scheduleChangedAt,
presets, limits, form incl. `cream`, unit incl. `appl`), `ScheduleVersion` (past schedules
for history; no day window or drift), `DoseLog` (takenAt, `slotAt`, status, note,
logged-by user), `PushSubscription`, `ReminderLog`. Times stored UTC; JSON stored as
strings.

## 5. API (Next.js route handlers, all under `/api`)

- `GET/POST /api/medicines`, `PATCH/DELETE /api/medicines/:id` (delete = archive), `PUT /api/medicines/reorder`
- `GET /api/doses?from&to&medicineId&personId` · `POST /api/doses` (optional `slotAt`; returns `{dose, check}`) · `PATCH/DELETE /api/doses/:id` (time change re-assigns `slotAt`)
- `GET/PATCH /api/profile`
- `GET/POST /api/persons`, `PATCH/DELETE /api/persons/:id`, `PATCH /api/persons/:id/access` (my reminders, log notices), `POST /api/persons/:id/share`, `POST /api/persons/join`, `DELETE /api/persons/:id/members/:userId`
- `POST /api/persons/:id/migrate` (guess schedules) · `POST /api/persons/:id/review` (confirm)
- `GET /api/push/config` · `POST/DELETE /api/push/subscription` · `POST /api/push/test` · `POST /api/reminders/snooze`
- `GET /api/events` (server-sent events: live changes for the user's persons; a blocked user's stream closes at the next heartbeat)
- Admin only: `GET /api/admin/users` (users + `signupsOpen`), `PATCH /api/admin/users/:id` (`{role?, blocked?}`), `PATCH /api/admin/settings` (`{signupsOpen}`)
- `GET /login?next=` (→ Authentik), `GET /logout` (→ Authentik end-session); route handlers, not pages
- `GET /api/export?format=csv|json` (incl. `slot_at`, `mode`, and missed slots as `missed` rows)

## 6. Auth

- **Auth.js (NextAuth v5)** with a generic OIDC provider pointed at Authentik
  (`AUTH_AUTHENTIK_ISSUER`, `AUTH_AUTHENTIK_ID`, `AUTH_AUTHENTIK_SECRET`).
- No login page in the app: signed out → `/login` → straight to Authentik's one login page
  (password or Google). Sign out (`/logout`) ends the Authentik session too.
- **Access gate** (added 2026-11-16, the standard for all of mikael's apps): Authentik has no
  group binding for pills; `access()` decides on every request. Users are keyed on the OIDC
  `sub` only. A new user gets in when sign-ups are open (pills starts **open**), or always
  when in the Authentik group `household` or `admins`. Otherwise they see a "not taking new
  users" page with "Use another account". Blocked users see "access removed".
- **Roles live in pills**: `User.role` `admin | member`. Members of the Authentik group
  `admins` are admin regardless (`User.idpAdmin`, refreshed per request) and can't be
  demoted or blocked in the app. Admins use **Settings → Admin** (`/admin`): sign-ups
  open/closed, user list (joined, last seen), make/remove admin, block / allow again.
  Blocking deletes the user's push subscriptions; their logged doses stay. Nobody can
  demote or block themselves.
- **Flood limits** (`lib/limits.ts`, 429 `limit`): max users in total and new users per
  24 h (then "try later", household included), persons per creator, medicines per person,
  doses per user per 24 h, open share codes per person, push subscriptions per user
  (oldest dropped), API requests per user per minute, share-code attempts, 64 KB JSON bodies.
- `AUTH_DEV_BYPASS=true` env for local dev → dev user (in `admins` + `household`); a
  `devUser=<name>` cookie is a second user with no groups (to try sharing and the gate).

## 7. i18n

- `next-intl` with `en` and `nb` message catalogs; locale stored on the user profile
  (and cookie for pre-login). Flag/label toggle in header. All dates via `Intl` with
  locale + 24 h clock for `nb`.

## 8. Help

- `?` in the header opens a contextual help sheet for the current screen.
- Help sheet: getting started, today's list, late doses (drift), the double-dose check, as-needed
  limits, reminders, sharing with others, "I'm not sure I took it", past doses, install-as-app.
- First-run onboarding: 3 short cards (add medicines → check off today's list → reminders)
  + medical disclaimer.

## 9. PWA & deployment

- `manifest.webmanifest`, icons, `standalone` display, theme color; installable on
  iOS/Android/desktop. Simple service worker for shell caching (read-only offline view
  of cached data; logging requires network — offline queue is a later feature). The service
  worker also shows reminder notifications (§2.5).
- **Version & auto-update**: every build is stamped with its build time in UTC
  (`2026.11.17-0933`, `NEXT_PUBLIC_APP_VERSION` in the Dockerfile; `dev` locally), shown as
  a grey "Pills <version>" line at the bottom of Settings and served by `GET /api/version`
  (no login, `no-store`). An open tab or installed app checks it when it comes back to the
  front, when the network returns, when the live stream reconnects (a deploy restarts the
  server) and every 5 min while visible; on a newer version it reloads and toasts "Updated
  to <version>". While a dialog with input (log sheet, edit dose, medicine, person, share
  code, join, night review) is open it shows "A new version is ready." + Reload instead.
  It never reloads twice for the same version (no loops). Next's `deploymentId` makes
  client-side navigations into a newer build hard reloads. The service worker is
  registered as `/sw.js?v=<version>`: each deploy installs a new worker whose cache is
  named after the version; old caches are deleted on activate, and pages are network-first.
- **Dockerfile** (Next standalone output) + healthcheck; deployed via Dokploy on the
  Hostinger VPS, domain `pills.valensendstad.no` (Traefik + Let's Encrypt), SQLite on a
  mounted volume, env vars for Authentik OIDC.

## 10. Nice-to-have backlog (not v1)

Different dose amounts per slot · weekday / every-N-days schedules · different day windows
on weekends · moving times on a time-zone change · offline logging queue · multi-profile
(carer logs for family member) · medication stock/refill tracking · doctor report PDF ·
Apple/Google Health export · med interaction warnings · widgets.

## 11. Implementation steps (each = commit; all done)

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

## Live updates & "someone else logged it" (added 2026-11-14)

Two people caring for the same person or pet should never both give the dose.

- **Live lists** — every open app holds one server-sent-events stream (`GET /api/events`)
  carrying changes for all persons the user can access: doses created / edited / deleted,
  medicines, person settings and members. Today, History and Settings refetch on any
  change for the person on screen (debounced 250 ms), after a dropped connection, and when
  the app comes back after more than 30 s in the background. In-process event bus
  (`lib/live.ts`, single container); recipients are computed at publish time from
  `PersonAccess`, so a user never hears about a person they can't access.
- **Overlay + chime** — a dose someone else logs for the person on screen shows a short
  note under the header for 6 s, on any tab (tap to dismiss): "Anna gave Rex Apoquel",
  "1 tablet · 14:05". Several doses from the same person within seconds merge into one
  note ("… Apoquel and Omega-3"); an undo takes the dose back out. The new Done row / as-
  needed card glows briefly. A two-note Web Audio chime plays unless turned off under
  Preferences → "Sound when someone else logs" (per device, shown only with shared
  persons; browsers allow sound only after the first tap on the page). A dose for another
  accessible person gives a quiet toast with **Show** (switches person).
- **Wording** (`lib/live-text.ts`, pure, shared with the push): by whose medicine it is —
  the logger's own ("Anna took Ibux"), the reader's own ("Anna gave you Ibux"), else
  "Anna gave Rex Apoquel"; creams are *applied*; skipped ("Anna skipped Drops for Rex") and
  not sure ("…, marked as not sure") have their own sentences. First names only.
- **Push when someone else logs** — opt-in per shared person and user
  (`PersonAccess.notifyLogs`, off by default), under Settings → Reminders → "Tell me when
  someone else logs" (needs the global reminders switch and a subscribed device). Sent
  10 s after the first dose (`NOTICE_DELAY_MS`, past the 8 s undo window): an undone dose
  sends nothing; the logger's doses for that person in those 10 s are one notification in
  the reader's language. Pending notices are lost on a restart. The service worker closes
  reminder notifications the logged doses answered, and skips showing the notice when a
  focused app window already showed it live (never on Safari, which revokes
  subscriptions that receive a push without a notification).
- Tapping a reminder or a notice opens the app on that person (`/?person=<id>`).

---

## 12. Settled decisions of the schedules and reminders rewrite (2026-11-12)

The first release of the schedule model was written from a separate design note
(a separate note, now folded in here). The product owner settled these; do not reopen them.

The app is meant to help people remember their medicine, including people who forget
easily (ADHD). Before the rewrite it modelled every medicine as "as needed, with a daily
maximum", so "once a day", "every 12 h" or "every 8 h" could not be entered and the
safety model warned falsely (85 % of a daily max of 1, a rolling 24 h sum that counted
yesterday's dose, "next OK" computed from the daily max). Hence the three modes and the
slot model in §2.

These were settled with the product owner. Do not reopen them during implementation.

1. **Three timing modes per medicine**: fixed times, interval, as needed (§2).
2. **Late doses in fixed mode do not move the schedule.** The next dose is pushed only
   when it would otherwise come unsafely soon, and only that one dose (§2.2).
3. **Scheduled medicines warn only about likely double doses.** No daily-max math, no
   85 % rule, no linear formula.
4. **As-needed medicines** keep a max per day and minimum gap. "Per day" is a rolling
   window with slack, because wake-up times vary by hours from day to day (§2.1).
5. **Home screen is a checklist for today**, ordered by time (§1.1).
6. **Unlogged doses become overdue, then missed** automatically (§2.2).
7. **Reminders by web push**: a heads-up before, one at dose time, repeats until logged,
   and Take / Snooze buttons on the notification (§2.5).
8. **Repeat defaults**: heads-up 10 min before, repeat every 15 min, stop after 2 h.
9. **No quiet hours.** The app points out night-time doses when the schedule is set up.
10. **Reminder settings**: global defaults per user, plus an on/off switch per medicine.
11. **Shared persons**: each user opts in to reminders per person. Default on for
    yourself, off for others. A dose logged by anyone stops reminders for everyone.
12. **Course length**: a medicine can have an end date ("for 7 days").
13. **Simple-first add flow**: name and "how often?", everything else optional.
14. **24-hour clock everywhere, in every locale. Never AM/PM.**
15. **Migration**: existing medicines get an auto-guessed schedule that the user reviews
    (§13).
16. **No dead settings**: on a device that cannot show notifications, reminder settings
    are hidden except one global on/off switch (§3).

Out of scope for this release: different dose amounts per slot, weekday or every-N-days
schedules, quiet hours, offline logging, stock and refill tracking. The data model in
§4 should not make these hard to add later, but build none of them.

---

## 13. Migration of pre-rewrite medicines

Auto-guess, then review. Guessing needs each person's timezone and their log history,
so it runs in application code, not in the SQL migration.

**SQL migration**: add the columns and tables from §4, drop `strictness`,
`wakeWindowH` and `scheduleHints`, set `PersonAccess.reminders = true` for self persons.
All existing medicines have `mode = null`. The entrypoint already snapshots the database
before `migrate deploy`.

**Guess**, run by `POST /api/persons/:id/migrate` with the client's timezone, called by
the client when it loads a person that has a medicine with `mode = null`. It is
idempotent and only touches medicines whose mode is still null. For each such medicine:

1. `doseAmount` = `defaultPreset`, else the first preset.
2. Take the taken and uncertain logs of the last 14 days, in local time.
3. Expected doses per day `n` = `maxPerDay / (maxPerIntake ?? doseAmount)`, rounded,
   when `maxPerDay` is set; otherwise the median number of doses on days with any dose.
4. **As needed** when there are fewer than 5 logs in the 14 days, or `n` is not 1–4, or
   the average is below 0.7 × `n` doses per day. Keep all limits.
5. Otherwise **fixed**: group the times of day into `n` clusters and round each cluster
   median to the nearest 30 minutes. If a cluster spreads more than ±90 minutes, use the
   default times from §1.5 for that `n` instead.
6. Never guess interval mode. The user can choose it in review.
7. Leave `scheduleReviewedAt` null. Archived medicines become `asNeeded`, already
   reviewed.

**Review**: while a person has medicines without `scheduleReviewedAt`, the home screen
shows a one-time review screen first: each medicine with its guess in words ("Medicine
B: twice a day, 08:00 and 20:00"), with **Looks right** and **Change** (opens the edit
form). "Confirm all" is available. Confirming sets `scheduleReviewedAt`. The review can
be closed and comes back as a banner until done.

Until a medicine is reviewed it appears in the checklist with its guessed schedule, but
it sends no reminders and derives no missed slots. This keeps a wrong guess from
producing wrong notifications. Existing dose logs keep `slotAt = null`.

The first user to open a shared person runs the guess and may do the review; the result
applies to everyone with access.

The code is `lib/guess.ts` (pure, tested in `lib/guess.test.ts`) and
`POST /api/persons/:id/migrate`.

---

## 14. Verification still open, and details left to the implementer

**Real-device checks** (not yet done; local tests cannot cover them). On an iPhone
(installed to the home screen) and on Android or desktop:
1. Subscribe, send the test notification, get a real heads-up and a due reminder.
2. Taken from the notification (Android / desktop; iOS shows no actions) and the app
   shows it; the creams' "Apply" wording; Taken on a drifted slot.
3. Log a dose in the app, on another device and as another user: the notification on the
   phone goes away (or shrinks to the slots still open) within about 15 s, with no extra
   alert. On iOS, check whether a notification can be closed from a push at all; if not,
   it stays until swiped.
4. Two slots open at once for one person: one notification with two lines, replaced by
   each new reminder.
5. Tapping a notification opens the app on that person.
6. With a live signed-in session through the proxy: `/api/events` stream, `groups` claim
   (akadmin shows as admin), an open tab reloading after a deploy.

**Left to the implementer:** layout and wording of rows, review screen and confirm sheet;
whether "taken early" needs a limit on how far ahead a slot can be filled (suggested: the
next slot only); snooze length is fixed at 30 minutes; whether `GET /api/safety/:id`
survives in reduced form.
