import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound } from "@/lib/api";
import { doseSchema } from "@/lib/schemas";
import { evaluateDose, type DoseEntry, type DoseStatus } from "@/lib/safety";

export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from") ? new Date(sp.get("from")!) : undefined;
    const to = sp.get("to") ? new Date(sp.get("to")!) : undefined;
    const medicineId = sp.get("medicineId") ?? undefined;
    const doses = await prisma.doseLog.findMany({
      where: {
        userId: user.id,
        ...(medicineId ? { medicineId } : {}),
        takenAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) },
      },
      orderBy: { takenAt: "desc" },
      take: 2000,
    });
    return NextResponse.json(doses);
  });
}

export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = doseSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    const { medicineId, amount, takenAt, status, note } = parsed.data;

    const medicine = await prisma.medicine.findFirst({
      where: { id: medicineId, userId: user.id },
    });
    if (!medicine) return notFound();

    const when = takenAt ?? new Date();
    const recent = await prisma.doseLog.findMany({
      where: {
        medicineId,
        userId: user.id,
        takenAt: { gte: new Date(when.getTime() - 48 * 3_600_000), lt: when },
      },
    });
    const safety = evaluateDose(
      {
        maxPerIntake: medicine.maxPerIntake,
        maxPerDay: medicine.maxPerDay,
        minIntervalMin: medicine.minIntervalMin,
        slack: user.strictness,
        wakeWindowH: user.wakeWindowH,
        countUncertain: user.countUncertain,
      },
      recent.map((d): DoseEntry => ({
        amount: d.amount,
        takenAt: d.takenAt,
        status: d.status as DoseStatus,
      })),
      amount,
      when,
    );

    const dose = await prisma.doseLog.create({
      data: { userId: user.id, medicineId, amount, takenAt: when, status, note },
    });
    return NextResponse.json({ dose, safety }, { status: 201 });
  });
}
