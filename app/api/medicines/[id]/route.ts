import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound } from "@/lib/api";
import { medicineSchema } from "@/lib/schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const existing = await prisma.medicine.findFirst({ where: { id, userId: user.id } });
    if (!existing) return notFound();
    const body = await req.json();
    const parsed = medicineSchema.partial().safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.message);
    const { presets, scheduleHints, ...rest } = parsed.data;
    const medicine = await prisma.medicine.update({
      where: { id },
      data: {
        ...rest,
        ...(presets !== undefined ? { presets: JSON.stringify(presets) } : {}),
        ...(scheduleHints !== undefined
          ? { scheduleHints: scheduleHints ? JSON.stringify(scheduleHints) : null }
          : {}),
        ...(body.unarchive ? { archivedAt: null } : {}),
      },
    });
    return NextResponse.json(medicine);
  });
}

// Archive (soft delete); hard-deletes only if the medicine has no logged doses.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const existing = await prisma.medicine.findFirst({
      where: { id, userId: user.id },
      include: { _count: { select: { doses: true } } },
    });
    if (!existing) return notFound();
    if (existing._count.doses === 0) {
      await prisma.medicine.delete({ where: { id } });
      return NextResponse.json({ deleted: true });
    }
    const medicine = await prisma.medicine.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return NextResponse.json(medicine);
  });
}
