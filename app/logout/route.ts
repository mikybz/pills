import { redirect } from "next/navigation";
import { authentikLogoutUrl, signOut } from "@/lib/auth";

/**
 * Signs out of pills and of Authentik, so the next sign-in can pick another account
 * (an Authentik session alone would sign the same account straight back in).
 */
export async function GET() {
  const authentik = authentikLogoutUrl();
  if (!authentik) redirect("/");
  await signOut({ redirect: false });
  redirect(authentik);
}
