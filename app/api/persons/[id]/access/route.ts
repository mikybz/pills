import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound, onlySent } from "@/lib/api";
import { accessSchema } from "@/lib/schemas";
import { hasPersonAccess } from "@/lib/persons";

type Params = { params: Promise<{ id: string }> };

// The signed-in user's own settings for a person they can access (reminders opt-in).
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    if (!(await hasPersonAccess(user.id, id))) return notFound();
    const body = await req.json();
    const parsed = accessSchema.partial().safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.message);
    const row = await prisma.personAccess.update({
      where: { personId_userId: { personId: id, userId: user.id } },
      data: onlySent(parsed.data, body),
    });
    return NextResponse.json({ reminders: row.reminders });
  });
}
