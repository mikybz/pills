import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest, notFound } from "@/lib/api";
import { dayWindowProblem, personUpdateSchema } from "@/lib/schemas";
import { getPersonWithAccess, hasPersonAccess, toPersonDTO } from "@/lib/persons";
import { publish } from "@/lib/live";

type Params = { params: Promise<{ id: string }> };

// Anyone with access may rename / change kind.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    if (!(await hasPersonAccess(user.id, id))) return notFound();
    const parsed = personUpdateSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    if (parsed.data.wakeTime || parsed.data.bedTime) {
      const existing = await prisma.person.findUnique({ where: { id } });
      if (!existing) return notFound();
      const problem = dayWindowProblem({
        wakeTime: parsed.data.wakeTime ?? existing.wakeTime,
        bedTime: parsed.data.bedTime ?? existing.bedTime,
      });
      if (problem) return badRequest(problem);
    }
    await prisma.person.update({ where: { id }, data: parsed.data });
    publish({ type: "person", personId: id, byUserId: user.id });
    const person = await getPersonWithAccess(id);
    return NextResponse.json(toPersonDTO(user, person!));
  });
}

// Only the creator may delete, and a user's own (self) person is never deletable.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    if (!(await hasPersonAccess(user.id, id))) return notFound();
    const person = await prisma.person.findUnique({ where: { id } });
    if (!person) return notFound();
    if (person.selfOfUserId !== null || person.createdById !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    await prisma.person.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  });
}
