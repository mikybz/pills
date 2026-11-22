import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, readJson, badRequest, notFound, tooMany } from "@/lib/api";
import { LIMITS } from "@/lib/limits";
import { doseSchema } from "@/lib/schemas";
import { findAccessibleMedicineWithPerson, resolvePersonId } from "@/lib/persons";
import { checkFor, lastTakenBefore, logsAround, resolveSlot } from "@/lib/doses-server";
import { kindOf } from "@/lib/types";
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
    const parsed = doseSchema.safeParse(await readJson(req));
    if (!parsed.success) return badRequest(parsed.error.message);
    const { medicineId, amount, takenAt, slotAt: requested, status, note } = parsed.data;

    const medicine = await findAccessibleMedicineWithPerson(user.id, medicineId);
    if (!medicine) return notFound();
    // Only a measurement may be 0 (a reading); a dose or a task is a positive amount.
    if (amount <= 0 && kindOf(medicine) !== "measure") return badRequest("amount must be positive");
    const loggedToday = await prisma.doseLog.count({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    if (loggedToday >= LIMITS.dosesPerUserPerDay) return tooMany();

    const when = takenAt ?? new Date();
    const logs = await logsAround(medicine, when.getTime());
    const slotAt = resolveSlot({ medicine, user, logs, at: when.getTime(), requested });
    // Server is the source of truth: the check runs again here with the assigned slot.
    const check = checkFor(
      medicine,
      user,
      logs,
      { amount, at: when.getTime(), status, slotAt },
      await lastTakenBefore(medicine, when.getTime()),
    );

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
    // The logging device closes its own reminder; it sends its push endpoint so it gets no "close" push.
    const endpoint = req.headers.get("x-push-endpoint")?.slice(0, 2048) || null;
    void doseCreated(dose, loggedBy, medicine, endpoint);
    return NextResponse.json({ dose: { ...dose, loggedBy }, check }, { status: 201 });
  });
}
