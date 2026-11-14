import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound, onlySent } from "@/lib/api";
import { doseSchema } from "@/lib/schemas";
import { findAccessibleDose, findAccessibleMedicineWithPerson } from "@/lib/persons";
import { logsAround, resolveSlot } from "@/lib/doses-server";
import { doseChanged } from "@/lib/live";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const existing = await findAccessibleDose(user.id, id);
    if (!existing) return notFound();
    const body = await req.json();
    const parsed = doseSchema.partial().omit({ medicineId: true }).safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.message);
    const { slotAt: requested, ...data } = onlySent(parsed.data, body);

    // Changing the time re-assigns the slot (window rule), unless a slot was sent.
    let slotAt: Date | null | undefined;
    const timeChanged = data.takenAt && data.takenAt.getTime() !== existing.takenAt.getTime();
    if (timeChanged || requested !== undefined) {
      const medicine = await findAccessibleMedicineWithPerson(user.id, existing.medicineId);
      if (!medicine) return notFound();
      const at = (data.takenAt ?? existing.takenAt).getTime();
      const logs = await logsAround(medicine, at, id);
      const slot = resolveSlot({ medicine, user, logs, at, requested, rule: "window" });
      slotAt = slot === null ? null : new Date(slot);
    }
    const dose = await prisma.doseLog.update({
      where: { id },
      data: { ...data, ...(slotAt !== undefined ? { slotAt } : {}) },
    });
    doseChanged("updated", dose, user.id);
    return NextResponse.json(dose);
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const existing = await findAccessibleDose(user.id, id);
    if (!existing) return notFound();
    await prisma.doseLog.delete({ where: { id } });
    doseChanged("deleted", existing, user.id);
    return NextResponse.json({ deleted: true });
  });
}
