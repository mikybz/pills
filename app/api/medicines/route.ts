import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest } from "@/lib/api";
import { medicineSchema } from "@/lib/schemas";

export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const includeArchived = req.nextUrl.searchParams.get("archived") === "true";
    const medicines = await prisma.medicine.findMany({
      where: { userId: user.id, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json(medicines);
  });
}

export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = medicineSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    const { presets, scheduleHints, ...rest } = parsed.data;
    const medicine = await prisma.medicine.create({
      data: {
        ...rest,
        userId: user.id,
        presets: JSON.stringify(presets),
        scheduleHints: scheduleHints ? JSON.stringify(scheduleHints) : null,
      },
    });
    return NextResponse.json(medicine, { status: 201 });
  });
}
