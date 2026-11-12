import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest } from "@/lib/api";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/lib/schemas";

/** Saves this device's push subscription for the signed-in user. */
export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = pushSubscriptionSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    const { endpoint, keys } = parsed.data;
    const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;
    // An endpoint belongs to one browser; if another user signed in there, it moves.
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent, userId: user.id },
      update: { p256dh: keys.p256dh, auth: keys.auth, userAgent, userId: user.id },
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  });
}

export async function DELETE(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = pushUnsubscribeSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: parsed.data.endpoint, userId: user.id },
    });
    return NextResponse.json({ ok: true });
  });
}
