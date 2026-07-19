import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withUser, badRequest } from "@/lib/api";

const reorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1) });

export async function PUT(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = reorderSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    const { ids } = parsed.data;
    const owned = await prisma.medicine.count({
      where: { id: { in: ids }, userId: user.id },
    });
    if (owned !== ids.length) return badRequest("Unknown medicine id");
    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.medicine.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    return NextResponse.json({ ok: true });
  });
}
