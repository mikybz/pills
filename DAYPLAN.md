# Pills: day window, late-dose drift, earlier doses, cream

Status: agreed design, not yet implemented. Written 2026-11-13 as the input for an
implementation session. Read `CLAUDE.md`, `AGENTS.md` and `PLAN.md` §1–2 first; this file
changes PLAN.md §1.1, §1.2, §1.5, §2.2, §2.3, §2.6 and the data model. Where this file and
PLAN.md disagree, this file wins, and PLAN.md is updated as part of the work (step 8).

You are expected to implement everything below, then publish it (step 9). The owner has
already approved merging to `main` and deploying; do not stop to ask for that.

## 0. What the owner reported, and what was decided

| Reported | Decision |
|---|---|
| Logging a forgotten dose from the previous day made today's next dose disappear | Bug. The `⋯` sheet sends the row's `slotAt` even when the time is moved to another day. Fix in client and server (§1), and add a clear "Log an earlier dose" entry. |
| "X times a day" puts doses at night | Each person gets a **day window** (wake / bed time, default 07:00–23:00). Suggested times stay inside it (§2). |
| Set awake time; existing medicines move into it; new ones follow it | Changing the window opens a **preview** of the medicines that have a night dose, with a checkbox per medicine; nothing moves silently (§2.4). |
| Some medicines must be taken at night | Per-medicine switch **Also at night** (`aroundTheClock`), off by default (§2.5). |
| Support "salve" | New form `cream` ("Cream / ointment", nb "Salve / krem") with unit `appl` and the verb "Apply" (§4). |
| Dose taken 2 h late should move the next one 1 h, rounded to half hours, not the bedtime dose | **Drift** rule, on by default, switchable per medicine (§3). |
| Quiet reminders at night | Rejected by the owner. Reminders behave as today. Do not add quiet hours. |

## 1. Earlier doses (bug fix + entry point)

### 1.1 The bug
`components/home-screen.tsx` opens `LogSheet` with the row's `slotAt`. `LogSheet.submit`
always passes it on, and `resolveSlot` in `lib/doses-server.ts` keeps any requested slot
that is a real slot. A dose backdated to yesterday from today's 20:00 row therefore fills
today's 20:00 slot.

### 1.2 Rule
A log opened from a row keeps that row's slot only when its time is not before the
slot's `windowStart`. Otherwise the slot is assigned by the existing window rule
(`assignSlot(..., { rule: "window" })`), which may give an earlier slot or none.

- Add a pure helper in `lib/schedule.ts`, e.g.
  `slotForLog(schedule, logs, rowSlotAt | undefined, at, now, opts): number | null`,
  that implements this (no row slot ⇒ plain `assignSlot` with rule `auto`).
- Server (`resolveSlot`): apply the same guard to `requested` for fixed mode. The server
  stays the source of truth, so a stale client or the service worker cannot reproduce
  the bug. `PATCH /api/doses/:id` goes through the same function.
- Client (`use-dose-logger.tsx`, `log-sheet.tsx`): use the helper for the dose check and
  send the resolved slot (`null` when it answers no slot).

### 1.3 "Counts as" line
In `LogSheet`, for scheduled medicines, when the chosen time is not "now", show one line
under the time field, updated live:
- "Counts as the 20:00 dose yesterday" (day word: today / yesterday / a date), or
- "Extra dose. It doesn't count for any scheduled dose."

### 1.4 Entry point
- Home: a quiet button under the checklist, **Log an earlier dose** (nb "Registrer en
  tidligere dose"). It opens a medicine picker (skipped when there is one medicine), then
  `LogSheet` with no row slot and the custom time field open.
- History: the same button, unless an equivalent "add dose" action already exists there.
- The toast for a log whose `takenAt` is not today names the day and time ("Logged:
  Ibux, yesterday 20:00"), since it will not appear under Done.

## 2. Day window

### 2.1 Data
- `Person.wakeTime String @default("07:00")`, `Person.bedTime String @default("23:00")`
  ("HH:MM", wall clock in `Person.timezone`).
- The window may wrap midnight (wake 15:00, bed 07:00). Awake length =
  `(bed − wake) mod 24 h`; valid when between 6 h and 23 h. Both ends count as awake.
- `personSchema` / `personUpdateSchema` accept both fields (validate the length on the
  merged result); `PersonDTO` exposes them.
- `Medicine.aroundTheClock Boolean @default(false)`, `Medicine.driftEnabled Boolean
  @default(true)`; add both to `medicineSchema`. They are not part of `ScheduleVersion`.
- One Prisma migration for all four columns.

### 2.2 Pure helpers (`lib/schedule.ts`, with tests)
- `Schedule` gains `day: { wake: string; bed: string } | null` (null when the medicine
  is around the clock) and `drift: boolean`.
- `scheduleOf` in `lib/types.ts` takes the person (`{ timezone, wakeTime, bedTime }`)
  instead of a bare time zone; update every call site (`doses-server.ts`,
  `reminders.ts`, `home-screen.tsx`, `settings-screen.tsx`, `use-dose-logger.tsx`,
  history). Stored `ScheduleVersion`s map to `day: null, drift: false`.
- `inSleep(time, day)`: replaces `isNight` (remove the fixed 23:00–06:00 rule).
- `spreadTimes(count, day)`: suggested times for "N times a day".
  - `step = 24 h / count`, `span = (count − 1) × step`, `slack = awake − span`.
  - `slack ≥ 0`: evenly spaced at `step`, first dose at `wake + min(60 min, slack / 2)`.
  - `slack < 0`: evenly spaced from `wake` to `bed`.
  - Round every time to the nearest 30 min and keep it inside the window.
  - With 07:00–23:00 this gives 08:00 · 08:00, 20:00 · 07:00, 15:00, 23:00 ·
    07:00, 12:30, 17:30, 23:00.
- `fitTimes(times, day)`: proposal for an existing schedule that has a time in the
  sleep window. Shift the whole schedule by the smallest amount that puts every time
  inside the window (06:00, 18:00 → 07:00, 19:00; 23:30 → 23:00). If no shift fits,
  return `spreadTimes(times.length, day)`. Returns null when nothing needs to move.

### 2.3 Medicine form (`components/medicine-dialog.tsx`)
- Times-a-day chips use `spreadTimes` with the current person's window, or the existing
  24 h `DEFAULT_TIMES` / `evenlySpaced` when **Also at night** is on.
- "Every … hours" at fixed times, and any hand-typed time, can still land in the sleep
  window. The night hint then offers two buttons: **Move into my day** (applies
  `fitTimes`) and **Keep night doses** (turns **Also at night** on). The hint names the
  person's window.
- More options: **Also at night** and **Adjust the next dose when I'm late** switches.

### 2.4 Setting the window, and the preview
- The person dialog in `components/people-section.tsx` gets "Usually awake from … to …"
  (two `TimeField`s). Settings also shows a "Day: 07:00–23:00" row for the current
  person that opens the same dialog.
- After saving a changed window, and from a Home banner ("Some doses are at night,
  outside 07:00–23:00 · Review"), open the **preview sheet**. It lists every active,
  unfinished, fixed-mode medicine that is not around the clock and has a time in the
  sleep window, with old → new times (`fitTimes`). Each row has three choices: **Move**
  (default), **Keep at night** (sets `aroundTheClock`), **Leave for now**.
- Apply = one `PATCH /api/medicines/:id` per changed medicine, so each goes through the
  existing schedule-edit path (`ScheduleVersion`, `scheduleChangedAt`).
- The banner shows whenever such a medicine exists, so after this release the owner's
  existing night doses are offered for review without any data migration.

### 2.5 Around-the-clock medicines
Ignore the window everywhere: 24 h spacing, never in the preview, no night hint, drift
without the bedtime clamp.

### 2.6 Interval mode
For a medicine that is not around the clock, an interval slot whose due time falls in
the sleep window keeps its `slotAt` but gets `effectiveAt` = the next wake time.

## 3. Late-dose drift

Applies in `fixedSlots` when `schedule.drift` is true, to the slot directly after one
filled by a taken / uncertain log at time `t`:

- `delay = t − previous.slotAt` (against the nominal time, so a dose taken on its
  drifted time still counts as late). `delay < 60 min` ⇒ no drift.
- `drift = floor(delay / 60 min) × 30 min` (2 h late ⇒ 1 h; 1 h ⇒ 30 min; 3 h 20 ⇒ 1 h 30).
- Not across the night: no drift when a wake time lies between the two slots (the first
  dose of a day never drifts), or when the slot's nominal time is in the sleep window.
- Never past bedtime: `slotAt + drift` is capped at that day's bed time. A dose at
  bedtime therefore never moves.
- `effectiveAt = max(slotAt + drift, t + minGap)`; the existing push rule stays as the
  safety floor and may still exceed bedtime, as today.
- This returns to the clock by itself: 08 / 13 / 18 / 23, first dose at 10:00 ⇒ 14:00,
  taken then ⇒ 18:30, taken then ⇒ 23:00.
- Skipped doses and early doses cause no drift. `driftEnabled = false` ⇒ today's
  behavior exactly.

UI: the row already shows the effective time with the original struck through. Add a
short reason under it ("Moved 1 h because the last dose was late"), and append "Next dose
moved to 21:00" to the logged toast when the log changes the next slot's time. Reminders
already use `effectiveAt`. Rewrite the help text `lateBody` in both languages.

## 4. Cream

- Form `cream` in `medicineSchema` and `FORMS`; labels "Cream / ointment" / "Salve / krem".
- Unit `appl` in `UNITS`, rendered through i18n like `pcs` ("1 application",
  "2 applications" / "1 påsmøring", "2 påsmøringer") in `formatDose` and `unitLabel`.
- Choosing the form `cream` while the unit is `pcs` switches the unit to `appl`;
  leaving `cream` while the unit is `appl` switches it back to `pcs`.
- Verb by form: Take / Take late anyway / Take now (early) and the push texts become
  Apply … ("Smør på …") for creams. Add `form` to `ReminderItem` for this.

## 5. Tests (`npx vitest run` must pass)

Update PLAN.md §2.6 and the existing tests whose expectations change:
- (4) 08/20 taken at 10:00: next is now **21:00** (20:00 with `drift: false`).
- (6) missed 08:00 taken at 16:00: next is now **23:00** (drift 4 h capped at bedtime;
  22:00 with `drift: false`).

New required scenarios:
13. Row log backdated to before the slot's window answers the earlier slot (or none),
    and today's slot stays open. Server guard covered through the pure helper.
14. `spreadTimes` for 1–6 doses with 07:00–23:00, a short window (09:00–21:00) and a
    wrapping window (15:00–07:00).
15. `fitTimes`: shift (06/18 → 07/19), single time (23:30 → 23:00), re-spread
    (06/12/18/00 → 07/12:30/17:30/23), nothing to do ⇒ null.
16. Drift: threshold, rounding, cascade back to the clock, bedtime cap, no drift over
    the night, none after a skip, none when disabled, none clamp when around the clock.
17. Interval mode: due time in the sleep window ⇒ effective at wake.
18. Reminder events use the drifted effective time.
19. `inSleep` at both window edges and for a wrapping window.

## 6. Out of scope
Quiet hours for reminders · different windows on weekends · per-slot dose amounts ·
moving times on a time-zone change.

## 7. Conventions to keep
`lib/schedule.ts`, `lib/safety.ts`, `lib/tz.ts` stay pure. All strings in both
`messages/en.json` and `messages/nb.json`. `TimeField` only, 24 h clock. PATCH bodies
through `onlySent()`. Base UI, no `asChild`. Read the Next.js guide in
`node_modules/next/dist/docs/` before touching routes or pages.

## 8. Order of work (one commit each, on branch `feature/day-window-drift`)
1. Schema + migration + zod schemas + DTOs; `scheduleOf` signature.
2. Pure helpers and rules (§1.2, §2.2, §2.6, §3) with tests (§5).
3. Earlier doses: server guard, log sheet, entry points, toast (§1).
4. Medicine form and switches (§2.3).
5. Person window setting, Home banner, preview sheet (§2.4).
6. Drift UI and help texts (§3).
7. Cream (§4).
8. Docs: fold this file into PLAN.md (§1.1, §1.2, §1.5, §2, §4, backlog), update
   CLAUDE.md and README, then delete this file.

Before publishing: `npx vitest run`, `npm run lint`, `npm run build`, and a walkthrough
in `npm run dev` with `AUTH_DEV_BYPASS=true` covering: backdating from a row and from the
new button; adding a 4-times-a-day medicine; changing the window and applying the
preview; a late dose moving the next one; a cream.

## 9. Publish
1. Push the branch, open a PR against `main` on `github.com/mikybz/pills`, merge it.
2. Dokploy builds and deploys every push to `main` (project "Pills", app "web"); the
   container entrypoint runs `prisma migrate deploy`. Use the `dokploy-admin` skill to
   follow the deployment and its logs until the migration and start-up succeed.
3. Verify `https://pills.valensendstad.no/api/health` returns 200.
4. Do not touch the VAPID env vars; regenerating them invalidates every push
   subscription.
5. Report what was deployed, plus anything from the walkthrough that could not be
   checked without a real phone.
