import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, badRequest } from "@/lib/api";
import { profileSchema } from "@/lib/schemas";

export async function GET() {
  return withUser(async (user) => NextResponse.json(user));
}

export async function PATCH(req: NextRequest) {
  return withUser(async (user) => {
    const parsed = profileSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.message);
    const updated = await prisma.user.update({ where: { id: user.id }, data: parsed.data });
    return NextResponse.json(updated);
  });
}
