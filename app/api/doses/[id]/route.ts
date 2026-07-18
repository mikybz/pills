import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound } from "@/lib/api";
import { doseSchema } from "@/lib/schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const existing = await prisma.doseLog.findFirst({ where: { id, userId: user.id } });
    if (!existing) return notFound();
    const parsed = doseSchema.partial().omit({ medicineId: true }).safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    const dose = await prisma.doseLog.update({ where: { id }, data: parsed.data });
    return NextResponse.json(dose);
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const existing = await prisma.doseLog.findFirst({ where: { id, userId: user.id } });
    if (!existing) return notFound();
    await prisma.doseLog.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  });
}
