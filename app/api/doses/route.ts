import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound } from "@/lib/api";
import { doseSchema } from "@/lib/schemas";
import { findAccessibleMedicineWithPerson, resolvePersonId } from "@/lib/persons";
import { checkFor, logsAround, resolveSlot } from "@/lib/doses-server";
import { doseCreated } from "@/lib/live";

export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from") ? new Date(sp.get("from")!) : undefined;
    const to = sp.get("to") ? new Date(sp.get("to")!) : undefined;
    const medicineId = sp.get("medicineId") ?? undefined;
    const personId = await resolvePersonId(user, sp.get("personId"));
    if (!personId) return notFound();
    const range = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const doses = await prisma.doseLog.findMany({
      where: {
        medicine: { personId },
        ...(medicineId ? { medicineId } : {}),
        // A log belongs to the range by its taken time or by the slot it answers.
        OR: [{ takenAt: range }, { slotAt: range }],
      },
      orderBy: { takenAt: "desc" },
      take: 20000,
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return NextResponse.json(
      doses.map(({ user: loggedBy, ...d }) => ({ ...d, loggedBy })),
    );
  });
}

export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = doseSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    const { medicineId, amount, takenAt, slotAt: requested, status, note } = parsed.data;

    const medicine = await findAccessibleMedicineWithPerson(user.id, medicineId);
    if (!medicine) return notFound();

    const when = takenAt ?? new Date();
    const logs = await logsAround(medicine, when.getTime());
    const slotAt = resolveSlot({ medicine, user, logs, at: when.getTime(), requested });
    // Server is the source of truth: the check runs again here with the assigned slot.
    const check = checkFor(medicine, user, logs, { amount, at: when.getTime(), status, slotAt });

    const dose = await prisma.doseLog.create({
      data: {
        userId: user.id,
        medicineId,
        amount,
        takenAt: when,
        slotAt: slotAt === null ? null : new Date(slotAt),
        status,
        note,
      },
    });
    const loggedBy = { id: user.id, name: user.name, email: user.email };
    void doseCreated(dose, loggedBy, medicine);
    return NextResponse.json({ dose: { ...dose, loggedBy }, check }, { status: 201 });
  });
}
