import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest } from "@/lib/api";
import { joinSchema } from "@/lib/schemas";
import { getPersonWithAccess, hashShareCode, toPersonDTO } from "@/lib/persons";
import { publish } from "@/lib/live";

// Redeem a one-time share code → gain access to the person.
export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = joinSchema.safeParse(await req.json());
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
