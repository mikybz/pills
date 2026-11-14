import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, notFound } from "@/lib/api";
import { hasPersonAccess } from "@/lib/persons";
import { publish } from "@/lib/live";

type Params = { params: Promise<{ id: string; userId: string }> };

// Remove a member: yourself (leave a shared person) or, as owner, someone else.
// The owner (creator / self user) can never be removed.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, userId } = await params;
  return withUser(async (user) => {
    if (!(await hasPersonAccess(user.id, id))) return notFound();
    const person = await prisma.person.findUnique({ where: { id } });
    if (!person) return notFound();
    const ownerId = person.selfOfUserId ?? person.createdById;
    if (userId === ownerId) {
      return NextResponse.json({ error: "owner cannot be removed" }, { status: 403 });
    }
    if (userId !== user.id && user.id !== ownerId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    await prisma.personAccess.deleteMany({ where: { personId: id, userId } });
    await prisma.user.updateMany({
      where: { id: userId, defaultPersonId: id },
      data: { defaultPersonId: null },
    });
    publish({ type: "person", personId: id, byUserId: user.id });
    return NextResponse.json({ removed: true });
  });
}
