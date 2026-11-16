import NextAuth from "next-auth";
import Authentik from "next-auth/providers/authentik";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ensureSelfPerson } from "@/lib/persons";
import { cookies } from "next/headers";
import { ADMIN_GROUP, HOUSEHOLD_GROUP, decideAccess } from "@/lib/access-rules";
import { LIMITS } from "@/lib/limits";

export const devBypass = process.env.AUTH_DEV_BYPASS === "true";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: devBypass
    ? []
    : [
        Authentik({
          clientId: process.env.AUTH_AUTHENTIK_ID,
          clientSecret: process.env.AUTH_AUTHENTIK_SECRET,
          issuer: process.env.AUTH_AUTHENTIK_ISSUER,
        }),
      ],
  // Never show Auth.js's own page: /login goes straight to Authentik.
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, profile }) {
      if (profile?.sub) token.sub = profile.sub;
      // Groups only arrive with the profile at sign-in; keep them in the token.
      if (profile) token.groups = Array.isArray(profile.groups) ? profile.groups.map(String) : [];
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.user.groups = Array.isArray(token.groups) ? (token.groups as string[]) : [];
      return session;
    },
  },
});

/** Where "Use another account" / sign-out ends: Authentik's own logout. */
export function authentikLogoutUrl(): string | null {
  const issuer = process.env.AUTH_AUTHENTIK_ISSUER;
  if (devBypass || !issuer) return null;
  return `${issuer.endsWith("/") ? issuer : `${issuer}/`}end-session/`;
}

interface Identity {
  id: string;
  email: string;
  name: string | null;
  groups: string[];
}

async function identity(): Promise<Identity | null> {
  if (devBypass) {
    // Dev only: a `devUser=anna` cookie signs in as a second user (to try sharing and
    // the gate); the default dev user is in `admins` and `household`.
    const alt = (await cookies()).get("devUser")?.value?.toLowerCase();
    if (alt && /^[a-z]{1,20}$/.test(alt)) {
      return { id: `dev-${alt}`, email: `${alt}@localhost`, name: alt[0].toUpperCase() + alt.slice(1), groups: [] };
    }
    return { id: "dev-user", email: "dev@localhost", name: "Dev User", groups: [ADMIN_GROUP, HOUSEHOLD_GROUP] };
  }
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    groups: session.user.groups ?? [],
  };
}

export type AppUser = User & { isAdmin: boolean };

export type Access =
  | { kind: "ok"; user: AppUser }
  | { kind: "anonymous" }
  | { kind: "signups_closed" }
  | { kind: "full" }
  | { kind: "removed" }
  | { kind: "email_taken" };

const DAY_MS = 24 * 60 * 60 * 1000;
/** lastSeenAt is written at most this often. */
const SEEN_EVERY_MS = 10 * 60 * 1000;

export async function signupsOpen(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: "signupsOpen" } });
  return row?.value === "true";
}

/**
 * Who is this request, and may they use pills? Creates the user on first sign-in when
 * the gate allows it. Users are keyed on Authentik's `sub` only, never matched by email.
 */
export async function access(): Promise<Access> {
  const id = await identity();
  if (!id) return { kind: "anonymous" };

  const existing = await prisma.user.findUnique({ where: { id: id.id } });
  const needCounts = !existing;
  const [open, userCount, newUsersToday] = needCounts
    ? await Promise.all([
        signupsOpen(),
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - DAY_MS) } } }),
      ])
    : [false, 0, 0];

  const gate = decideAccess({
    groups: id.groups,
    existing,
    signupsOpen: open,
    userCount,
    newUsersToday,
    limits: LIMITS,
  });
  if (gate.kind !== "ok") return gate;

  const idpAdmin = id.groups.includes(ADMIN_GROUP);
  let user: User;
  if (existing) {
    const stale = !existing.lastSeenAt || Date.now() - existing.lastSeenAt.getTime() > SEEN_EVERY_MS;
    const changed = existing.idpAdmin !== idpAdmin || existing.email !== id.email || (id.name && existing.name !== id.name);
    user =
      stale || changed
        ? await prisma.user
            .update({
              where: { id: existing.id },
              data: { idpAdmin, email: id.email, name: id.name ?? existing.name, lastSeenAt: new Date() },
            })
            .catch(() => existing) // e.g. the new email belongs to another row: keep the old one
        : existing;
  } else {
    const taken = await prisma.user.findUnique({ where: { email: id.email }, select: { id: true } });
    if (taken) return { kind: "email_taken" };
    user = await prisma.user.create({
      data: { id: id.id, email: id.email, name: id.name, idpAdmin, lastSeenAt: new Date() },
    });
  }

  if (!user.defaultPersonId) {
    const self = await ensureSelfPerson(user);
    user = { ...user, defaultPersonId: self.id };
  }
  return { kind: "ok", user: { ...user, isAdmin: gate.isAdmin } };
}

/** The signed-in, allowed user, or null. */
export async function currentUser(): Promise<AppUser | null> {
  const a = await access();
  return a.kind === "ok" ? a.user : null;
}
