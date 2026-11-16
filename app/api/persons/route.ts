import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, readJson, badRequest, tooMany } from "@/lib/api";
import { LIMITS } from "@/lib/limits";
import { personSchema } from "@/lib/schemas";
import { getPersonWithAccess, listPersons, toPersonDTO } from "@/lib/persons";

export async function GET() {
  return withUser(async (user) => NextResponse.json(await listPersons(user)));
}

export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = personSchema.safeParse(await readJson(req));
    if (!parsed.success) return badRequest(parsed.error.message);
    const own = await prisma.person.count({ where: { createdById: user.id } });
    if (own >= LIMITS.personsCreatedPerUser) return tooMany();
    const created = await prisma.person.create({
      data: {
        ...parsed.data,
        createdById: user.id,
        access: { create: { userId: user.id } }, // reminders off by default for others
      },
    });
    const person = await getPersonWithAccess(created.id);
    return NextResponse.json(toPersonDTO(user, person!), { status: 201 });
  });
}
