import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound } from "@/lib/api";
import { migrateSchema } from "@/lib/schemas";
import { hasPersonAccess } from "@/lib/persons";
import { guessSchedule } from "@/lib/guess";
import { DAY, type DoseStatus } from "@/lib/schedule";
import { parsePresets } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

/**
 * Guesses a schedule for this person's medicines that predate schedules
 * (mode = null). Idempotent: only touches medicines whose mode is still null.
 * The result applies to everyone with access; it is reviewed before reminders.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    if (!(await hasPersonAccess(user.id, id))) return notFound();
    const parsed = migrateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest(parsed.error.message);

    const pending = await prisma.medicine.findMany({ where: { personId: id, mode: null } });
    if (!pending.length) return NextResponse.json({ migrated: 0 });

    const person = parsed.data.timezone
      ? await prisma.person.update({ where: { id }, data: { timezone: parsed.data.timezone } })
      : await prisma.person.findUniqueOrThrow({ where: { id } });

    const now = Date.now();
    let migrated = 0;
    for (const m of pending) {
      const logs = await prisma.doseLog.findMany({
        where: { medicineId: m.id, takenAt: { gte: new Date(now - 14 * DAY) } },
        select: { takenAt: true, status: true },
      });
      const guess = guessSchedule({
        presets: parsePresets(m),
        defaultPreset: m.defaultPreset,
        maxPerIntake: m.maxPerIntake,
        maxPerDay: m.maxPerDay,
        archived: m.archivedAt !== null,
        logs: logs.map((l) => ({ takenAt: l.takenAt.getTime(), status: l.status as DoseStatus })),
        timezone: person.timezone,
        now,
      });
      const res = await prisma.medicine.updateMany({
        where: { id: m.id, mode: null },
        data: {
          mode: guess.mode,
          doseAmount: guess.doseAmount,
          times: guess.times ? JSON.stringify(guess.times) : null,
          scheduleReviewedAt: guess.reviewed ? new Date(now) : null,
        },
      });
      migrated += res.count;
    }
    return NextResponse.json({ migrated });
  });
}
