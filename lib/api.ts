import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import type { User } from "@prisma/client";

export async function withUser(
  handler: (user: User) => Promise<NextResponse>,
): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  return handler(user);
}

/**
 * zod's .partial() still fills in .default() values, which would silently reset
 * fields on PATCH. Keep only the keys the client actually sent.
 */
export function onlySent<T extends object>(parsed: T, body: unknown): Partial<T> {
  const sent = body && typeof body === "object" ? body : {};
  return Object.fromEntries(
    Object.entries(parsed).filter(([k]) => k in sent),
  ) as Partial<T>;
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
