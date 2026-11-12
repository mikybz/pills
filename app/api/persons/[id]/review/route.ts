import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound } from "@/lib/api";
import { reviewSchema } from "@/lib/schemas";
import { hasPersonAccess } from "@/lib/persons";

type Params = { params: Promise<{ id: string }> };

/** Confirms guessed schedules ("Looks right" / "Confirm all"). */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    if (!(await hasPersonAccess(user.id, id))) return notFound();
    const parsed = reviewSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest(parsed.error.message);
    const { medicineIds } = parsed.data;
    const res = await prisma.medicine.updateMany({
      where: {
        personId: id,
        mode: { not: null },
        scheduleReviewedAt: null,
        ...(medicineIds ? { id: { in: medicineIds } } : {}),
      },
      data: { scheduleReviewedAt: new Date() },
    });
    return NextResponse.json({ reviewed: res.count });
  });
}
