import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, notFound, tooMany } from "@/lib/api";
import { LIMITS } from "@/lib/limits";
import {
  SHARE_TOKEN_TTL_MS,
  generateShareCode,
  hashShareCode,
  hasPersonAccess,
} from "@/lib/persons";

type Params = { params: Promise<{ id: string }> };

// Generates a one-time share code, valid for 24 h. Only the hash is stored.
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    if (!(await hasPersonAccess(user.id, id))) return notFound();
    const code = generateShareCode();
    const expiresAt = new Date(Date.now() + SHARE_TOKEN_TTL_MS);
    // Housekeeping: drop expired/used tokens.
    await prisma.shareToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
    });
    const open = await prisma.shareToken.count({ where: { personId: id } });
    if (open >= LIMITS.openShareCodesPerPerson) return tooMany();
    await prisma.shareToken.create({
      data: { tokenHash: hashShareCode(code), personId: id, createdById: user.id, expiresAt },
    });
    return NextResponse.json({ code, expiresAt: expiresAt.toISOString() }, { status: 201 });
  });
}
