import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest } from "@/lib/api";
import { personSchema } from "@/lib/schemas";
import { getPersonWithAccess, listPersons, toPersonDTO } from "@/lib/persons";

export async function GET() {
  return withUser(async (user) => NextResponse.json(await listPersons(user)));
}

export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = personSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    const created = await prisma.person.create({
      data: {
        ...parsed.data,
        createdById: user.id,
        access: { create: { userId: user.id } },
      },
    });
    const person = await getPersonWithAccess(created.id);
    return NextResponse.json(toPersonDTO(user, person!), { status: 201 });
  });
}
