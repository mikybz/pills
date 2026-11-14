import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound, onlySent } from "@/lib/api";
import { medicineSchema, scheduleProblem } from "@/lib/schemas";
import { findAccessibleMedicineWithPerson } from "@/lib/persons";
import { scheduleChanged, toMedicineData } from "@/lib/medicines-server";
import { currentScheduleFrom, parseTimes } from "@/lib/types";
import { publish } from "@/lib/live";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const existing = await findAccessibleMedicineWithPerson(user.id, id);
    if (!existing) return notFound();
    const body = await req.json();
    const parsed = medicineSchema.partial().omit({ personId: true }).safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.message);
    const sent = onlySent(parsed.data, body);
    const data = toMedicineData(sent);

    const merged = {
      mode: (sent.mode ?? existing.mode) as string | null,
      doseAmount: "doseAmount" in sent ? sent.doseAmount : existing.doseAmount,
      times: "times" in sent ? sent.times : parseTimes(existing.times),
      intervalH: "intervalH" in sent ? sent.intervalH : existing.intervalH,
      startsOn: "startsOn" in sent ? sent.startsOn : existing.startsOn,
      endsOn: "endsOn" in sent ? sent.endsOn : existing.endsOn,
    };
    const problem = scheduleProblem(merged);
    if (problem) return badRequest(problem);

    const now = new Date();
    // Saving the form confirms a migrated (guessed) schedule.
    const confirming = body.confirmSchedule === true && !existing.scheduleReviewedAt;
    const changed = scheduleChanged(existing, data);
    const from = currentScheduleFrom(existing);

    const medicine = await prisma.$transaction(async (tx) => {
      if (changed && from !== null && existing.mode) {
        // Keep the old schedule so history derives past missed slots from it.
        await tx.scheduleVersion.create({
          data: {
            medicineId: id,
            mode: existing.mode,
            doseAmount: existing.doseAmount,
            times: existing.times,
            intervalH: existing.intervalH,
            startsOn: existing.startsOn,
            endsOn: existing.endsOn,
            minIntervalMin: existing.minIntervalMin,
            timezone: existing.person.timezone,
            validFrom: new Date(from),
            validTo: now,
          },
        });
      }
      return tx.medicine.update({
        where: { id },
        data: {
          ...data,
          ...(changed && from !== null ? { scheduleChangedAt: now } : {}),
          ...(confirming ? { scheduleReviewedAt: now } : {}),
          ...(body.unarchive ? { archivedAt: null } : {}),
        },
      });
    });
    publish({ type: "medicines", personId: existing.personId, byUserId: user.id });
    return NextResponse.json(medicine);
  });
}

// Archive (soft delete); hard-deletes only if the medicine has no logged doses.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    if (!(await findAccessibleMedicineWithPerson(user.id, id))) return notFound();
    const existing = await prisma.medicine.findFirst({
      where: { id },
      include: { _count: { select: { doses: true } } },
    });
    if (!existing) return notFound();
    if (existing._count.doses === 0) {
      await prisma.medicine.delete({ where: { id } });
      publish({ type: "medicines", personId: existing.personId, byUserId: user.id });
      return NextResponse.json({ deleted: true });
    }
    const medicine = await prisma.medicine.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    publish({ type: "medicines", personId: existing.personId, byUserId: user.id });
    return NextResponse.json(medicine);
  });
}
