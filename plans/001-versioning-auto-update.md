# 001 — Versioning and auto-update

Status: agreed (temporary plan: delete this file, and `plans/` if empty, in the commit that finishes it)

## Goal

pills gets what every app on this setup must have, as described in the new-app skill's
`references/versioning.md` (`~/.claude/skills/new-app/references/versioning.md`):

1. A version per build: the build time in UTC (`2026.11.17-0933`).
2. The version visible in the app (bottom of the settings/account screen).
3. Open tabs and the installed PWA reload themselves after a deploy, at a safe moment,
   then say "Updated to <version>".
4. No stale app code from caches.

## Do it like the template

`mikybz/app-template` (commit 86af04b, `/data/workspace/app-template`) has a working
version for this stack. Copy and adapt:
- `lib/version.ts`, `app/api/version/route.ts`, `components/update-check.tsx` (mounted in
  `app/layout.tsx`)
- the version stamp in the `Dockerfile` (`NEXT_PUBLIC_APP_VERSION=$(date -u …) npm run build`)
- `deploymentId` in `next.config.ts` (keep next-intl's wrapper)

## pills-specific points

- **i18n**: the texts ("Updated to …", "A new version is ready.", "Reload") go in
  `messages/en.json` and `messages/nb.json`.
- **Service worker** (`public/sw.js`, push notifications): check it caches no app code,
  or that its cache is named after the version (see section 4 of versioning.md).
- **Reload blocker**: call `setReloadBlocker()` while a dialog with unsaved input is open.
- Ask the user when unsure (e.g. where the version line goes).

## Done when

- `npm test`, `npm run lint` and `npm run build` pass. After the deploy,
  `GET /api/version` returns the build's version, and a tab left open reloads after the
  next deploy.
- PLAN.md §9 (PWA & deployment) describes the versioning as current behavior.
- This file is deleted.
