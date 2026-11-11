import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound, onlySent } from "@/lib/api";
import { medicineSchema } from "@/lib/schemas";
import { findAccessibleMedicine } from "@/lib/persons";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const existing = await findAccessibleMedicine(user.id, id);
    if (!existing) return notFound();
    const body = await req.json();
    const parsed = medicineSchema.partial().omit({ personId: true }).safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.message);
    const { presets, scheduleHints, ...rest } = onlySent(parsed.data, body);
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
    if (!(await findAccessibleMedicine(user.id, id))) return notFound();
    const existing = await prisma.medicine.findFirst({
      where: { id },
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
