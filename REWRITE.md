# Pills rewrite: from overdose guard to medicine reminder

Status: agreed design, not yet implemented. Written 2026-11-12 as the input for the
implementation session. It replaces PLAN.md sections 1.1–1.3, 1.5 and 2. Everything else
in PLAN.md (auth, persons and sharing, i18n, deployment) stays as it is unless this
document says otherwise.

The whole change ships in one release.

## 1. Why

The app is meant to help people remember their medicine, including people who forget
easily (ADHD). The current version has no schedule concept. It models every medicine as
"as needed, with a daily maximum" and derives timing from a formula. A prescription such
as "once a day", "every 12 hours" or "every 8 hours" cannot be entered, and the safety
model produces false warnings for it.

| Reported problem | Cause in the current code |
|---|---|
| Hard to add "once a day / every 12 h / every 8 h" | The medicine form has only max per intake, max per day and a minimum interval in minutes. `Medicine.scheduleHints` exists but has no UI and is never read. |
| A once-a-day medicine warns when taken | `lib/safety.ts:128` warns when the dose brings the total above 85 % of the daily max. With max 1 per day, one dose is 100 %. |
| Yesterday's intake causes a warning today | `lib/safety.ts:122` sums a rolling 24 h. Taken 09:30 yesterday and 08:00 today gives a red "over daily max". Backdated doses do the same. |
| Timing does not match the prescription | "Next OK" is `amount / maxPerDay × wakeWindowH × (1 − slack)`. An every-12-h medicine becomes "OK" after about 5 h. |
| No reminders | Not built. The service worker only caches the shell. |

## 2. Decisions

These were settled with the product owner. Do not reopen them during implementation.

1. **Three timing modes per medicine**: fixed times, interval, as needed (section 3).
2. **Late doses in fixed mode do not move the schedule.** The next dose is pushed only
   when it would otherwise come unsafely soon, and only that one dose (section 3.2).
3. **Scheduled medicines warn only about likely double doses.** No daily-max math, no
   85 % rule, no linear formula.
4. **As-needed medicines** keep a max per day and minimum gap. "Per day" is a rolling
   window with slack, because wake-up times vary by hours from day to day (section 3.4).
5. **Home screen is a checklist for today**, ordered by time (section 5.1).
6. **Unlogged doses become overdue, then missed** automatically (section 3.2).
7. **Reminders by web push**: a heads-up before, one at dose time, repeats until logged,
   and Take / Snooze buttons on the notification (section 6).
8. **Repeat defaults**: heads-up 10 min before, repeat every 15 min, stop after 2 h.
9. **No quiet hours.** The app points out night-time doses when the schedule is set up.
10. **Reminder settings**: global defaults per user, plus an on/off switch per medicine.
11. **Shared persons**: each user opts in to reminders per person. Default on for
    yourself, off for others. A dose logged by anyone stops reminders for everyone.
12. **Course length**: a medicine can have an end date ("for 7 days").
13. **Simple-first add flow**: name and "how often?", everything else optional.
14. **24-hour clock everywhere, in every locale. Never AM/PM.**
15. **Migration**: existing medicines get an auto-guessed schedule that the user reviews
    (section 8).
16. **No dead settings**: on a device that cannot show notifications, reminder settings
    are hidden except one global on/off switch (section 5.5).

Out of scope for this release: different dose amounts per slot, weekday or every-N-days
schedules, quiet hours, offline logging, stock and refill tracking. The data model in
section 4 should not make these hard to add later, but build none of them.

## 3. The scheduling model

### 3.1 Modes

| Mode | Stored as | Prescription it fits | Next dose is |
|---|---|---|---|
| `fixed` | `times: ["08:00","20:00"]`, wall clock in the person's timezone | "Once a day", "morning and evening", most "every 12 h / 8 h" | The next clock time |
| `interval` | `intervalH: 8` | "Every 8 hours" where the gap matters more than the clock | Last intake + interval |
| `asNeeded` | optional `maxPerDay`, `minIntervalMin`, `maxPerIntake` | Painkillers, allergy tablets | No schedule |

Every scheduled medicine has one `doseAmount` (for example 1 tablet) used for all slots.

### 3.2 Fixed mode

**Slots.** Each time in `times` produces one slot per local day between `startsOn` and
`endsOn` (both optional, inclusive). A slot is identified by its UTC instant, `slotAt`.

**Minimum gap.** One number drives lateness, pushing and warnings:

```
gap(slot)   = time from this slot to the next slot
minGap      = minIntervalMin if set, otherwise gap / 2
```

**Slot states**, all derived from the schedule and the dose log. Nothing is stored:

| State | Condition |
|---|---|
| upcoming | now is before `slotAt − leadMin` |
| due | from `slotAt − leadMin` until `slotAt` |
| overdue | after `slotAt`, not logged, before the cutoff |
| missed | not logged, and now is past the cutoff `nextSlotAt − minGap` |
| taken / skipped | a dose log with this `slotAt` exists (`uncertain` counts as taken) |

With defaults, a 08:00 + 20:00 medicine can be taken for the morning slot until 14:00. A
once-daily 08:00 medicine can be taken until 20:00.

**Late doses.** Taking the 08:00 dose at 10:00 leaves the 20:00 slot at 20:00. This is
the common case and the reason fixed mode is the default.

**Push rule (the "semi-floating" part).** If a dose is taken at time `t`, the next slot's
effective time is `max(nextSlotAt, t + minGap)`. Only that one slot moves. The slot after
it is back on the clock. With default `minGap` this only happens when a missed dose is
taken late anyway, or when the user set a doctor's minimum gap larger than half the
interval. Reminders use the effective time.

**Which slot a tap fills.** When the user logs a scheduled medicine without picking a
row: the oldest due or overdue slot; if none, the next upcoming slot (taken early). A
missed slot is filled only by tapping that row ("Take late anyway") or by logging with
"taken earlier" at a time that falls in its window.

**Double-dose warning.** Show one confirm sheet before logging when either holds:

- the slot being filled already has a taken or uncertain log, or
- the previous taken dose of this medicine is less than `minGap` ago.

The sheet states the fact ("You took this at 08:05, 40 minutes ago") and offers "Log
anyway" and "Cancel". The app never blocks logging. There is one warning level, not three.

### 3.3 Interval mode

- Next due = `takenAt` of the last taken dose + `intervalH`. A skipped dose advances the
  schedule from its `slotAt`.
- With no dose yet, the first dose is due immediately (or at `startsOn`).
- There is no missed state. An unlogged dose stays overdue; reminders stop after the
  repeat limit. Taking it restarts the interval from the actual time.
- `minGap` = `minIntervalMin` if set, otherwise `intervalH / 2`. Same double-dose warning.
- `slotAt` on the log records the due time it answered.

### 3.4 As needed

- No slots, no reminders, never due or missed.
- Warn (same single confirm sheet) when any holds:
  - amount is above `maxPerIntake`,
  - last taken dose is less than `minIntervalMin` ago,
  - total in the limit window plus this amount is above `maxPerDay`.
- **Limit window = 24 h minus slack. Slack defaults to 4 h, so the window is 20 h.**
  A dose taken at 08:00 stops counting at 04:00 the next day, so getting up a few hours
  earlier than yesterday does not trigger a warning. Keep the slack as one named
  constant in `lib/safety.ts` so it is easy to tune or turn into a setting later.
- No "approaching the limit" warning. The card states the facts instead:
  "2 of 3 used · next free at 14:30".
- Presets (1–4 quick amounts) stay for as-needed medicines.

### 3.5 Removed

- The linear budget model, `recentLoad`, `requiredGapMs`, the 85 % rule, the 110 % rule.
- `User.strictness` and `User.wakeWindowH`, with their settings UI and help text.
- Green / yellow / red levels. The result is `ok` or `warn` with reasons.
- The "Today" ribbon with progress bars.

`User.countUncertain` stays: when off, uncertain doses are ignored by the as-needed
limits. For slots, an uncertain log always fills the slot.

## 4. Data model changes

SQLite via Prisma. JSON stays as strings.

**Medicine**: add

| Field | Type | Notes |
|---|---|---|
| `mode` | `String?` | `fixed`, `interval`, `asNeeded`. `null` means not yet migrated (section 8). New medicines always get a value. |
| `doseAmount` | `Float?` | Amount per scheduled dose. Required for fixed and interval. |
| `times` | `String?` | JSON array of `"HH:MM"`, sorted. Replaces `scheduleHints`; drop that column. |
| `intervalH` | `Float?` | Interval mode only. |
| `startsOn`, `endsOn` | `String?` | Local dates `YYYY-MM-DD` in the person's timezone. |
| `remindersEnabled` | `Boolean @default(true)` | Per-medicine switch. |
| `scheduleReviewedAt` | `DateTime?` | Set when a user confirms a migrated schedule. New medicines get it at creation. Reminders fire only when it is set. |

Keep `presets`, `defaultPreset`, `maxPerIntake`, `maxPerDay`, `minIntervalMin`. For
scheduled medicines only `minIntervalMin` is used.

**Person**: add `timezone String @default("Europe/Oslo")` (IANA name). Fixed times are
wall-clock times in this zone. The client sends its own zone when it creates a person
and during migration. Editable in Settings → People.

**DoseLog**: add `slotAt DateTime?`, the scheduled instant this log answers. `null` for
as-needed doses. Add index `[medicineId, slotAt]`.

**PersonAccess**: add `reminders Boolean @default(false)`. The migration sets it to
`true` on rows where the person is the user's own self person. `ensureSelfPerson` in
`lib/persons.ts` must create the row with `true`.

**User**: drop `strictness`, `wakeWindowH`. Add `remindersOn Boolean @default(true)`
(global switch; when off, nothing is sent to this user), `remindLeadMin Int @default(10)`,
`nagEveryMin Int @default(15)`, `nagMaxMin Int @default(120)`. `remindLeadMin = 0`
turns the heads-up off; `nagEveryMin = 0` turns repeats off.

**New: PushSubscription** — `id`, `userId`, `endpoint @unique`, `p256dh`, `auth`,
`userAgent`, `createdAt`. Delete the row when the push service answers 404 or 410.

**New: ReminderLog** — `medicineId`, `slotAt`, `userId`, `kind` (`headsUp`, `due`,
`nag`, `snooze`), `seq Int` (repeat number, 0 otherwise), `until DateTime?` (snooze
only), `sentAt`. Unique on `[medicineId, slotAt, userId, kind, seq]`. It makes sending
idempotent across restarts. Prune rows older than 7 days.

## 5. User interface

### 5.1 Home: today's checklist

```
DUE NOW
 [ ] 08:00  Medicine A  1 tablet   [Take]
 [ ] 08:00  Medicine B  1 tablet   [Take]

LATER TODAY
     14:00  Medicine C  1 tablet
     20:00  Medicine B  1 tablet

DONE
 [x] 06:10  Medicine C  1 tablet

AS NEEDED
 Painkiller   last 3 h ago   [1] [2]
```

- **Due now** holds due and overdue slots, oldest first, including overdue slots from
  yesterday that have not reached their cutoff. Overdue rows show "1 h 20 min late".
  One tap on Take logs the dose now, with the existing 8-second undo toast.
- **Later today** lists upcoming slots until local midnight. Tapping a row offers "Take
  now" (early), which runs the double-dose check.
- **Missed** appears only when there are missed slots today, between Due now and Later.
  Each row offers "Take late anyway" and "Skip".
- **Done** shows today's taken and skipped logs with the actual time.
- **As needed** shows one compact card per as-needed medicine with preset buttons, the
  last intake, and the limit line.
- A pushed slot shows its effective time with the original struck through.
- Each row's `⋯` menu keeps the current log sheet: custom amount, taken earlier, not
  sure, skip, note.
- A medicine past its `endsOn` leaves the checklist. Settings shows it as finished and
  offers to archive it.
- Empty state for a day with everything done: a clear "All done for today".
- The screen re-evaluates every minute and on focus, so rows move between sections
  without a reload.

### 5.2 Add and edit medicine

First screen, nothing else required:

1. **Name**
2. **How often?** chips: Once a day · Twice a day · 3 times a day · 4 times a day ·
   Every … hours · As needed
3. **Dose**: amount and unit, default `1` and `pcs` (shown as "tablet" / "tablett")

Then, depending on the choice:

- The "times a day" chips create fixed mode with evenly spaced default times anchored
  on the first one: 08:00 · 08:00, 20:00 · 07:00, 15:00, 23:00 · 06:00, 12:00, 18:00,
  00:00. Every time is editable. Changing the first time offers to shift the others.
- "Every … hours" asks for the hours, then a choice between **At fixed times**
  (recommended; converts to clock times when 24 divides evenly) and **Count from when I
  last took it** (interval mode).
- "As needed" shows optional max per day and minimum hours between doses.
- When any time falls between 23:00 and 06:00, show a plain hint: "One dose lands at
  night (23:00)". For interval mode shorter than 12 h, hint that doses can land at
  night. No blocking.

**More options** (collapsed): course length ("for N days" or an end date), reminders
on/off, minimum gap, color, form, presets and max per intake (as needed), notes.

The minimum-interval input is in hours, not minutes. Storage stays in minutes.

Editing a schedule affects slots from now on. Past logs keep their `slotAt`.

### 5.3 Time input and display

- All formatting passes `hourCycle: "h23"` explicitly in `lib/format.ts`.
- Do not use native `<input type="time">` or `datetime-local` for entry. They follow the
  device locale and show AM/PM on some devices. Build one small `TimeField` component
  (HH and MM numeric fields) and use it in the medicine form, the log sheet
  (`components/log-sheet.tsx:163`) and the edit dialog
  (`components/edit-dose-dialog.tsx:110`). The date part can stay a native date input.

### 5.4 History

Today the history screen (`components/history-screen.tsx`) shows only what was logged:
a dot timeline for 3 days / week, bars of dose counts or amounts for month / year / all,
and a flat list of the latest 100 doses. It cannot show a dose that was not taken, and
it reports "no history" when nothing was logged even if doses were missed. With
schedules, the question history must answer changes from "how much did I take?" to
"did I take everything, and what did I miss?".

Keep the range tabs, the medicine filter, tap-to-edit and export. Change the following.

**Missed slots are derived**, so history needs the schedule as well as the logs. Use the
same pure function as the home screen. Derive them only from `scheduleReviewedAt`
onward. Do not invent missed doses for the period before the rewrite. A schedule edit
must not rewrite the past: missed slots before the edit are computed from the old
schedule, so store the previous schedule with its end time when a schedule changes (a
small `ScheduleVersion` table, or a JSON history column on the medicine).

**Summary line** at the top for the chosen range and filter, scheduled medicines only:
"Last 7 days: 19 of 21 taken · 2 missed". Hidden when there are no scheduled medicines.

**Day list** replaces the flat dose list. Grouped by local day, newest first, loaded a
range at a time instead of capped at 100:

```
Wed 11 Nov                          5 of 6 taken
  08:05  Medicine A   1 tablet
  08:05  Medicine B   1 tablet
  14:40  Medicine C   1 tablet      40 min late
  20:00  Medicine B   1 tablet      MISSED
  21:15  Painkiller   2 tablets     as needed
```

- A taken row shows the actual time, and how late it was when more than 30 minutes.
- A missed row shows the scheduled time. Tapping it offers "I took it" (opens the log
  sheet with that slot and time prefilled) and "Mark as skipped".
- Skipped and uncertain keep their current badges.
- Tapping a logged row opens the edit dialog as today. Changing the time re-assigns
  `slotAt` on the server.

**Timeline (3 days / week)**: add a hollow marker at each missed slot's scheduled time,
in the medicine's lane and color. Hollow against filled carries the meaning, not color.

**Month**: when the view contains scheduled medicines, replace the daily bars with a
calendar grid. Each day shows complete, partly taken, or nothing taken, with a shape or
count as well as color. Tapping a day scrolls the day list to it. When the filter is one
as-needed medicine, keep the existing amount bars.

**Year / all**: for scheduled medicines, bars of the share of slots taken per month.
As-needed medicines keep the existing count or amount bars.

**Empty state**: shown only when the range has neither logs nor derived slots.

**Export** adds `slotAt` and the medicine's mode, and includes missed slots as rows with
status `missed`.

### 5.5 Settings

- Remove strictness and waking hours.
- New **Reminders** section. At the top, one global on/off switch
  (`User.remindersOn`). Below it, only when the device supports notifications: enable on
  this device (permission + subscribe), heads-up minutes, repeat interval, repeat limit,
  "Send test notification", and a per-person list of switches
  (`PersonAccess.reminders`).
- **Hide what the device cannot use.** Detect support on the client (`serviceWorker` in
  `navigator`, `PushManager` and `Notification` in `window`). On a device without
  support, the Reminders section shows only the global switch and one line saying this
  device cannot show notifications. Everything else is hidden, not disabled: the
  detailed reminder settings, the per-person switches, the per-medicine reminder switch
  in the medicine form, and the "enable reminders" prompt after the migration review.
  The settings keep their stored values and still apply on the user's other devices.
- An iPhone or iPad where the app is not installed to the home screen counts as
  unsupported. There the one line says to add the app to the home screen to get
  reminders, with the steps.
- With the global switch off, the detailed settings are hidden on every device.
- Onboarding and help text are rewritten for the new model. All strings go in both
  `messages/en.json` and `messages/nb.json`.

## 6. Reminders

### 6.1 What is sent

For each slot of a medicine with `remindersEnabled`, `scheduleReviewedAt` set, and not
past `endsOn`, to each user who has `User.remindersOn`, `PersonAccess.reminders` on for
that person, and at least one push subscription:

| Kind | When | Text |
|---|---|---|
| heads-up | effective slot time − `remindLeadMin` | "In 10 min: Medicine A, 1 tablet" |
| due | effective slot time | "Time to take Medicine A, 1 tablet" |
| repeat | every `nagEveryMin` after, until `nagMaxMin` | "Still not taken: Medicine A (08:00)" |

- Nothing is sent once the slot has a log of any status, by any user.
- Slots of the same person at the same instant are combined into one notification. Use
  the notification `tag` `personId:slotAt` so a later reminder replaces the earlier one
  instead of stacking.
- For another person or a pet, prefix the name: "Rex: time to take …".
- Notification text follows the receiving user's `locale`.
- Reminders use each user's own lead and repeat settings.

### 6.2 Actions

- **Taken**: the service worker calls `POST /api/doses` for each medicine in the
  notification, with `slotAt` and `takenAt = now`. It is a same-origin fetch, so the
  session cookie is sent. If the response is 401 or the request fails, open the app on
  the home screen instead. Do not queue silently.
- **Snooze**: writes a `snooze` ReminderLog row with `until = now + 30 min`. No reminder
  for that slot goes to that user before then. Other users are not affected.
- Tapping the notification body opens the home screen.
- iOS does not show action buttons; tapping opens the app. That is acceptable.
- When the app opens or logs a dose, it closes its own stale notifications with
  `registration.getNotifications()`.

### 6.3 Engine

- Library: `web-push`, with VAPID keys in `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. Generate once and add them to the Dokploy
  environment before the release is deployed.
- Read `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md` and
  `instrumentation.md` in the same folder first (AGENTS.md: this Next version differs
  from older ones).
- The scheduler is a 60-second tick inside the Next server, started from
  `instrumentation.ts` `register()` when `NEXT_RUNTIME === "nodejs"`. The deployment is
  a single container with SQLite, so no external worker or queue is needed. Guard
  against double start with a global flag.
- Each tick: load scheduled medicines with their recent logs, call a pure function that
  returns the reminder events falling in `(lastTick, now]`, insert the ReminderLog row,
  and send only if the insert succeeded. After a restart, look back at most 5 minutes so
  downtime does not produce a burst of old reminders.
- All timing logic lives in the pure module so it is unit-tested without a clock or a
  database. The tick itself only does I/O.
- `public/sw.js` gains `push` and `notificationclick` handlers. Bump the cache name.

## 7. Code structure

- **`lib/schedule.ts`** (new, pure, no I/O): slot generation for a time range, slot
  state, effective time with the push rule, slot assignment for a tap, next due for
  interval mode, and reminder events for a time window. Used by the client (checklist),
  the API (assigning `slotAt` on write), and the reminder tick.
- **`lib/safety.ts`** (rewritten, pure): `checkDose()` returning `{ level: "ok" | "warn",
  reasons }` for the double-dose check and the as-needed limits.
- Timezone math: wall-clock times to UTC instants must handle DST. Use `@date-fns/tz`
  (the project already uses date-fns v4) or `Intl.DateTimeFormat` with `timeZone`. On
  the spring-forward day a nonexistent time moves to the next valid minute. On the
  fall-back day a repeated time produces one slot, the first occurrence.
- `POST /api/doses` accepts an optional `slotAt`. When it is absent for a scheduled
  medicine, the server assigns it with the same pure function as the client. The server
  result is the source of truth.
- `GET /api/safety/:id` is replaced by, or reduced to, the new check. Remove what is
  unused.
- New routes: `POST/DELETE /api/push/subscription`, `POST /api/push/test`,
  `POST /api/reminders/snooze`, `PATCH` for `PersonAccess.reminders`, and the migration
  routes in section 8. All go through `withUser()` and the access helpers in
  `lib/persons.ts`. PATCH bodies go through `onlySent()`.
- Update `CLAUDE.md` and PLAN.md's affected sections when the work is done.

### Required unit tests

At minimum, these scenarios, each of which is a bug or a decision above:

1. Once daily 08:00: taking it at 08:00 gives no warning, on the first day and after.
2. Once daily: taken 09:30 yesterday and 08:00 today gives no warning.
3. A backdated dose logged for yesterday evening does not change today's slots or warn.
4. 08:00 + 20:00: taken at 10:00, the next slot stays 20:00.
5. 08:00 + 20:00: morning slot is overdue at 13:59 and missed at 14:00.
6. 08:00 + 20:00: missed morning dose taken at 16:00 pushes the next to 22:00; the slot
   after that is 08:00 again.
7. Second tap on a slot that is already logged warns.
8. Interval 8 h: taken at 09:10 makes the next due 17:10; a skip advances from `slotAt`.
9. As needed, max 3: doses at 08, 14, 20, then 06:00 the next day gives no warning; a
   fourth dose at 23:00 the same day warns.
10. Slots across both DST changes in `Europe/Oslo`.
11. `endsOn` yesterday produces no slots today.
12. Reminder events: heads-up, due, repeats every 15 min up to 2 h, none after a log,
    none during a snooze, pushed slot uses the effective time.

## 8. Migration of existing data

Auto-guess, then review. Guessing needs each person's timezone and their log history,
so it runs in application code, not in the SQL migration.

**SQL migration**: add the columns and tables from section 4, drop `strictness`,
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
   default times from section 5.2 for that `n` instead.
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

## 9. Rollout

1. Generate VAPID keys and add the three environment variables in Dokploy.
2. Deploy. The entrypoint backs up the database and applies the migration.
3. On first open each user sees the review screen, then a prompt to enable reminders on
   the device.
4. Verify on a real iPhone (installed to home screen) and on Android or desktop:
   subscribe, test notification, a real heads-up and due reminder, Taken from the
   notification, and that logging on one device stops repeats on another.

## 10. Left to the implementer

These are details, not product decisions. Pick the simpler option.

- Exact layout and wording of the checklist rows, review screen and confirm sheet.
- Whether the "taken early" assignment needs a limit on how far ahead a slot can be
  filled. Suggested: the next slot only.
- Snooze length is fixed at 30 minutes unless it turns out to be trivial to make it a
  setting.
- Whether `GET /api/safety/:id` survives in reduced form or is removed.
