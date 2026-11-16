import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { devBypass, signIn } from "@/lib/auth";
import { safeNext } from "@/lib/access-rules";

/** No login page in the app: straight to Authentik (one login page for all apps). */
export async function GET(req: NextRequest) {
  const to = safeNext(req.nextUrl.searchParams.get("next") ?? req.nextUrl.searchParams.get("callbackUrl"));
  if (devBypass) redirect(to);
  // Sets the PKCE/state cookies, then redirects to Authentik.
  await signIn("authentik", { redirectTo: to });
}
