import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAdmin } from "@/lib/api";
import { signupsOpen } from "@/lib/auth";
import { LIMITS } from "@/lib/limits";

/** Everything the admin screen shows. No medicine or dose data: that stays private. */
export async function GET() {
  return withAdmin(async () => {
    const [users, open] = await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          idpAdmin: true,
          blockedAt: true,
          createdAt: true,
          lastSeenAt: true,
        },
      }),
      signupsOpen(),
    ]);
    return NextResponse.json({ users, signupsOpen: open, maxUsers: LIMITS.maxUsers });
  });
}
