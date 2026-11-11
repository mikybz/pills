import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound } from "@/lib/api";
import { resolvePersonId } from "@/lib/persons";
import { medicineSchema } from "@/lib/schemas";

export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const includeArchived = req.nextUrl.searchParams.get("archived") === "true";
    const personId = await resolvePersonId(user, req.nextUrl.searchParams.get("personId"));
    if (!personId) return notFound();
    const medicines = await prisma.medicine.findMany({
      where: { personId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json(medicines);
  });
}

export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = medicineSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    const { presets, scheduleHints, personId: requested, ...rest } = parsed.data;
    const personId = await resolvePersonId(user, requested);
    if (!personId) return notFound();
    const medicine = await prisma.medicine.create({
      data: {
        ...rest,
        personId,
        presets: JSON.stringify(presets),
        scheduleHints: scheduleHints ? JSON.stringify(scheduleHints) : null,
      },
    });
    return NextResponse.json(medicine, { status: 201 });
  });
}
