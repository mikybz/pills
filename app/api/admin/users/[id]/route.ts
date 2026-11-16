import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { badRequest, notFound, readJson, withAdmin } from "@/lib/api";
import { adminChangeProblem } from "@/lib/access-rules";
import { adminUserSchema } from "@/lib/schemas";

type Params = { params: Promise<{ id: string }> };

/** Make/unmake admin, block/allow again. Not yourself, not an Authentik admin. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withAdmin(async (admin) => {
    const parsed = adminUserSchema.safeParse(await readJson(req));
    if (!parsed.success) return badRequest(parsed.error.message);
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, idpAdmin: true } });
    if (!target) return notFound();
    const problem = adminChangeProblem(admin.id, target);
    if (problem) return badRequest(problem);
    const { role, blocked } = parsed.data;
    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(role ? { role } : {}),
        ...(blocked === undefined ? {} : { blockedAt: blocked ? new Date() : null }),
      },
      select: { id: true, role: true, blockedAt: true },
    });
    // A blocked user gets no more reminders or log notices.
    if (blocked) await prisma.pushSubscription.deleteMany({ where: { userId: id } });
    return NextResponse.json(updated);
  });
}
