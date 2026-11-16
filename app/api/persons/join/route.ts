import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, readJson, badRequest, tooMany } from "@/lib/api";
import { LIMITS } from "@/lib/limits";
import { allow } from "@/lib/rate-limit";
import { joinSchema } from "@/lib/schemas";
import { getPersonWithAccess, hashShareCode, toPersonDTO } from "@/lib/persons";
import { publish } from "@/lib/live";

// Redeem a one-time share code → gain access to the person.
export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    // Codes are guessable only by brute force: cap the attempts.
    if (!allow(`join:${user.id}`, LIMITS.joinAttemptsPer15Min, 15 * 60_000)) return tooMany();
    const parsed = joinSchema.safeParse(await readJson(req));
    if (!parsed.success) return badRequest(parsed.error.message);
    const now = new Date();
    const tokenHash = hashShareCode(parsed.data.code);
    // Atomic consume: only one redeemer can flip usedAt.
    const consumed = await prisma.shareToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now, usedById: user.id },
    });
    if (consumed.count !== 1) {
      return NextResponse.json({ error: "invalid_code" }, { status: 400 });
    }
    const token = await prisma.shareToken.findUnique({ where: { tokenHash } });
    await prisma.personAccess.upsert({
      where: { personId_userId: { personId: token!.personId, userId: user.id } },
      create: { personId: token!.personId, userId: user.id },
      update: {},
    });
    publish({ type: "person", personId: token!.personId, byUserId: user.id });
    const person = await getPersonWithAccess(token!.personId);
    return NextResponse.json(toPersonDTO(user, person!));
  });
}
