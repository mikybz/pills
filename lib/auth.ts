import NextAuth from "next-auth";
import Authentik from "next-auth/providers/authentik";
import { prisma } from "@/lib/db";
import { ensureSelfPerson } from "@/lib/persons";
import { cookies } from "next/headers";

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
  callbacks: {
    jwt({ token, profile }) {
      if (profile?.sub) token.sub = profile.sub;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});

const DEV_USER = {
  id: "dev-user",
  email: "dev@localhost",
  name: "Dev User",
};

/**
 * Returns the DB user for the current request, creating it on first login.
 * Returns null when unauthenticated.
 */
export async function currentUser() {
  let identity: { id: string; email: string; name: string | null };
  if (devBypass) {
    // Dev only: a `devUser=anna` cookie signs in as a second user (to try sharing).
    const alt = (await cookies()).get("devUser")?.value?.toLowerCase();
    identity =
      alt && /^[a-z]{1,20}$/.test(alt)
        ? { id: `dev-${alt}`, email: `${alt}@localhost`, name: alt[0].toUpperCase() + alt.slice(1) }
        : DEV_USER;
  } else {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) return null;
    identity = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
    };
  }
  const user = await prisma.user.upsert({
    where: { id: identity.id },
    create: identity,
    update: {},
  });
  if (!user.defaultPersonId) {
    const self = await ensureSelfPerson(user);
    return { ...user, defaultPersonId: self.id };
  }
  return user;
}
