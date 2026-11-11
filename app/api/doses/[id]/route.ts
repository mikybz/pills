import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound, onlySent } from "@/lib/api";
import { doseSchema } from "@/lib/schemas";
import { findAccessibleDose } from "@/lib/persons";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const existing = await findAccessibleDose(user.id, id);
    if (!existing) return notFound();
    const body = await req.json();
    const parsed = doseSchema.partial().omit({ medicineId: true }).safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.message);
    const dose = await prisma.doseLog.update({ where: { id }, data: onlySent(parsed.data, body) });
    return NextResponse.json(dose);
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const existing = await findAccessibleDose(user.id, id);
    if (!existing) return notFound();
    await prisma.doseLog.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  });
}
