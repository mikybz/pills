import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withUser, badRequest } from "@/lib/api";
import { publish } from "@/lib/live";

const reorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1) });

export async function PUT(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = reorderSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    const { ids } = parsed.data;
    // All ids must belong to one person the user can access.
    const meds = await prisma.medicine.findMany({
      where: { id: { in: ids }, person: { access: { some: { userId: user.id } } } },
      select: { personId: true },
    });
    if (meds.length !== ids.length || new Set(meds.map((m) => m.personId)).size !== 1) return badRequest("Unknown medicine id");
    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.medicine.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    publish({ type: "medicines", personId: meds[0].personId, byUserId: user.id });
    return NextResponse.json({ ok: true });
  });
}
