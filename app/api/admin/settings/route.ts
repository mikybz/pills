import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { badRequest, readJson, withAdmin } from "@/lib/api";
import { adminSettingsSchema } from "@/lib/schemas";

/** Sign-ups open/closed. Closed: only household, admins and existing users get in. */
export async function PATCH(req: NextRequest) {
  return withAdmin(async () => {
    const parsed = adminSettingsSchema.safeParse(await readJson(req));
    if (!parsed.success) return badRequest(parsed.error.message);
    const value = String(parsed.data.signupsOpen);
    await prisma.appSetting.upsert({
      where: { key: "signupsOpen" },
      create: { key: "signupsOpen", value },
      update: { value },
    });
    return NextResponse.json({ signupsOpen: parsed.data.signupsOpen });
  });
}
