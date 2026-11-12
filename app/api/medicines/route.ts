import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound } from "@/lib/api";
import { resolvePersonId } from "@/lib/persons";
import { medicineSchema, scheduleProblem } from "@/lib/schemas";
import { toMedicineData } from "@/lib/medicines-server";

export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const sp = req.nextUrl.searchParams;
    const includeArchived = sp.get("archived") === "true";
    const personId = await resolvePersonId(user, sp.get("personId"));
    if (!personId) return notFound();
    const medicines = await prisma.medicine.findMany({
      where: { personId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      ...(sp.get("versions") === "true"
        ? { include: { scheduleVersions: { orderBy: { validFrom: "asc" } } } }
        : {}),
    });
    return NextResponse.json(medicines);
  });
}

export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = medicineSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    const problem = scheduleProblem(parsed.data);
    if (problem) return badRequest(problem);
    const personId = await resolvePersonId(user, parsed.data.personId);
    if (!personId) return notFound();
    // New medicines go to the end of the list.
    const last = await prisma.medicine.aggregate({ where: { personId }, _max: { sortOrder: true } });
    const medicine = await prisma.medicine.create({
      data: {
        ...(toMedicineData(parsed.data) as object),
        name: parsed.data.name,
        mode: parsed.data.mode,
        presets: JSON.stringify(parsed.data.presets),
        personId,
        sortOrder: parsed.data.sortOrder ?? (last._max.sortOrder ?? -1) + 1,
        // A new medicine's schedule is set by the user, so it counts as reviewed.
        scheduleReviewedAt: new Date(),
      },
    });
    return NextResponse.json(medicine, { status: 201 });
  });
}
