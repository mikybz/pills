import { NextResponse } from "next/server";
import { access, type AppUser } from "@/lib/auth";
import { LIMITS } from "@/lib/limits";
import { allow } from "@/lib/rate-limit";

/** Runs the access gate; every API route goes through this (or withAdmin). */
export async function withUser(
  handler: (user: AppUser) => Promise<NextResponse>,
): Promise<NextResponse> {
  const a = await access();
  if (a.kind === "anonymous") {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (a.kind !== "ok") return NextResponse.json({ error: a.kind }, { status: 403 });
  if (!allow(`api:${a.user.id}`, LIMITS.requestsPerMinute, 60_000)) return tooMany();
  return handler(a.user);
}

export async function withAdmin(
  handler: (user: AppUser) => Promise<NextResponse>,
): Promise<NextResponse> {
  return withUser(async (user) =>
    user.isAdmin ? handler(user) : NextResponse.json({ error: "forbidden" }, { status: 403 }),
  );
}

/**
 * The request's JSON body, or undefined when it's too big or not JSON (zod then
 * rejects it with a 400).
 */
export async function readJson(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > LIMITS.maxBodyBytes) return undefined;
  const text = await req.text().catch(() => "");
  if (text.length > LIMITS.maxBodyBytes) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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

/** A flood limit was hit (LIMITS). The client shows a "limit reached" message. */
export function tooMany() {
  return NextResponse.json({ error: "limit" }, { status: 429 });
}
