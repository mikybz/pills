import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, readJson, badRequest, notFound, tooMany } from "@/lib/api";
import { LIMITS } from "@/lib/limits";
import { resolvePersonId } from "@/lib/persons";
import { medicineSchema, scheduleProblem } from "@/lib/schemas";
import { toMedicineData } from "@/lib/medicines-server";
import { publish } from "@/lib/live";

export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const sp = req.nextUrl.searchParams;
    const includeArchived = sp.get("archived") === "true";
    const personId = await resolvePersonId(user, sp.get("personId"));
    if (!personId) return notFound();
    const [medicines, last] = await Promise.all([
      prisma.medicine.findMany({
        where: { personId, ...(includeArchived ? {} : { archivedAt: null }) },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        ...(sp.get("versions") === "true"
          ? { include: { scheduleVersions: { orderBy: { validFrom: "asc" } } } }
          : {}),
      }),
      // Care schedules count from the last log, which can be older than any loaded range.
      prisma.doseLog.groupBy({ by: ["medicineId"], where: { medicine: { personId } }, _max: { takenAt: true } }),
    ]);
    const lastBy = new Map(last.map((r) => [r.medicineId, r._max.takenAt]));
    return NextResponse.json(medicines.map((m) => ({ ...m, lastLogAt: lastBy.get(m.id) ?? null })));
  });
}

export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = medicineSchema.safeParse(await readJson(req));
    if (!parsed.success) return badRequest(parsed.error.message);
    const problem = scheduleProblem(parsed.data);
    if (problem) return badRequest(problem);
    const personId = await resolvePersonId(user, parsed.data.personId);
    if (!personId) return notFound();
    if ((await prisma.medicine.count({ where: { personId } })) >= LIMITS.medicinesPerPerson) return tooMany();
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
    // A new regular task counts from when it was last done: its first log. It is
    // set-up data, so it goes out as a medicines change, not as "Anna did … just now".
    if (parsed.data.lastDoneAt && medicine.mode === "flex") {
      await prisma.doseLog.create({
        data: {
          userId: user.id,
          medicineId: medicine.id,
          amount: 1,
          takenAt: new Date(Math.min(parsed.data.lastDoneAt.getTime(), Date.now())),
          status: "taken",
        },
      });
    }
    publish({ type: "medicines", personId: personId, byUserId: user.id });
    return NextResponse.json(medicine, { status: 201 });
  });
}
