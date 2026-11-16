import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, readJson, badRequest } from "@/lib/api";
import { LIMITS } from "@/lib/limits";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/lib/schemas";

/** Saves this device's push subscription for the signed-in user. */
export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = pushSubscriptionSchema.safeParse(await readJson(req));
    if (!parsed.success) return badRequest(parsed.error.message);
    const { endpoint, keys } = parsed.data;
    const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;
    // An endpoint belongs to one browser; if another user signed in there, it moves.
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent, userId: user.id },
      update: { p256dh: keys.p256dh, auth: keys.auth, userAgent, userId: user.id },
    });
    const extra = await prisma.pushSubscription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip: LIMITS.pushSubscriptionsPerUser,
      select: { id: true },
    });
    if (extra.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((s) => s.id) } } });
    return NextResponse.json({ ok: true }, { status: 201 });
  });
}

export async function DELETE(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = pushUnsubscribeSchema.safeParse(await readJson(req));
    if (!parsed.success) return badRequest(parsed.error.message);
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: parsed.data.endpoint, userId: user.id },
    });
    return NextResponse.json({ ok: true });
  });
}
