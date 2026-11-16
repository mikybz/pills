/**
 * Who may use the app, and as what. Pure: the caller loads the facts.
 * Standard for all of mikael's apps (new-app skill, references/access.md):
 * Authentik says who someone is; this decides whether they get in.
 */

/** Authentik group: admin in every app, can't be demoted or blocked in the app. */
export const ADMIN_GROUP = "admins";
/** Authentik group: family, let in even when sign-ups are closed. */
export const HOUSEHOLD_GROUP = "household";

export type Role = "admin" | "member";

export type Gate =
  | { kind: "ok"; create: boolean; isAdmin: boolean }
  | { kind: "signups_closed" }
  | { kind: "full" }
  | { kind: "removed" };

export interface GateFacts {
  /** Authentik groups from the token. */
  groups: readonly string[];
  /** The app's row for this `sub`, if any. */
  existing: { role: string; blockedAt: Date | null } | null;
  signupsOpen: boolean;
  /** Totals for the flood limits (only needed for a new user). */
  userCount: number;
  newUsersToday: number;
  limits: { maxUsers: number; maxNewUsersPerDay: number };
}

export function decideAccess(f: GateFacts): Gate {
  const idpAdmin = f.groups.includes(ADMIN_GROUP);
  if (f.existing) {
    if (f.existing.blockedAt && !idpAdmin) return { kind: "removed" };
    return { kind: "ok", create: false, isAdmin: idpAdmin || f.existing.role === "admin" };
  }
  if (idpAdmin) return { kind: "ok", create: true, isAdmin: true };
  if (!f.groups.includes(HOUSEHOLD_GROUP) && !f.signupsOpen) return { kind: "signups_closed" };
  // Flood guard, household included: a burst of sign-ups pauses new accounts.
  if (f.userCount >= f.limits.maxUsers || f.newUsersToday >= f.limits.maxNewUsersPerDay) {
    return { kind: "full" };
  }
  return { kind: "ok", create: true, isAdmin: false };
}

/** Why an admin may not change this user (null = allowed). */
export function adminChangeProblem(
  actorId: string,
  target: { id: string; idpAdmin: boolean },
): "self" | "idp_admin" | null {
  if (target.id === actorId) return "self";
  if (target.idpAdmin) return "idp_admin";
  return null;
}

/** Only same-origin paths after login: no open redirect. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : "/";
}
