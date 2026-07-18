import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound } from "@/lib/api";
import { evaluateDose, type DoseEntry, type DoseStatus } from "@/lib/safety";

type Params = { params: Promise<{ medicineId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { medicineId } = await params;
  return withUser(async (user) => {
    const medicine = await prisma.medicine.findFirst({
      where: { id: medicineId, userId: user.id },
    });
    if (!medicine) return notFound();

    const amountParam = req.nextUrl.searchParams.get("amount");
    const presets = JSON.parse(medicine.presets) as number[];
    const amount = amountParam
      ? Number(amountParam)
      : (medicine.defaultPreset ?? presets[0] ?? 1);
    if (!Number.isFinite(amount) || amount <= 0) return badRequest("invalid amount");

    const now = new Date();
    const recent = await prisma.doseLog.findMany({
      where: {
        medicineId,
        userId: user.id,
        takenAt: { gte: new Date(now.getTime() - 48 * 3_600_000), lte: now },
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
      now,
    );
    return NextResponse.json(safety);
  });
}
