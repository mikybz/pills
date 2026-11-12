import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound } from "@/lib/api";
import { snoozeSchema } from "@/lib/schemas";
import { findAccessibleMedicine } from "@/lib/persons";
import { SNOOZE_MS } from "@/lib/reminders";

/**
 * Snooze from a notification: no reminder for these slots goes to this user for
 * 30 minutes, then one more. Other users are not affected.
 */
export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = snoozeSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    const until = new Date(Date.now() + SNOOZE_MS);
    for (const { medicineId, slotAt } of parsed.data.items) {
      if (!(await findAccessibleMedicine(user.id, medicineId))) return notFound();
      const seq =
        (await prisma.reminderLog.count({
          where: { medicineId, slotAt, userId: user.id, kind: "snooze" },
        })) + 1;
      await prisma.reminderLog.create({
        data: { medicineId, slotAt, userId: user.id, kind: "snooze", seq, until },
      });
    }
    return NextResponse.json({ until: until.toISOString() });
  });
}
