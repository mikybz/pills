/**
 * The app's version: the build time in UTC, e.g. 2026.11.17-0933. The Dockerfile stamps
 * it into NEXT_PUBLIC_APP_VERSION, so the server and the browser bundle of one build carry
 * the same value. "dev" locally (no update checks). Standard: new-app skill
 * `references/versioning.md`.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

/** Window event: check for a new version now (sent by the live stream when it reconnects). */
export const CHECK_VERSION_EVENT = "pills:check-version";

let blockers = 0;

/**
 * Something a reload would lose is open (a dialog with input, a one-time share code).
 * While any is, a new version shows a "Reload" toast instead of reloading by itself.
 * Returns the release. Use `useBlockReload()` in components.
 */
export function blockReload(): () => void {
  blockers++;
  let released = false;
  return () => {
    if (!released) blockers--;
    released = true;
  };
}

export function reloadBlocked() {
  return blockers > 0;
}
