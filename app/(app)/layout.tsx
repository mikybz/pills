import { access, devBypass } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { GateNotice } from "@/components/gate-notice";
import { redirect } from "next/navigation";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const a = await access();
  if (a.kind === "anonymous") redirect(devBypass ? "/" : "/login");
  if (a.kind !== "ok") return <GateNotice kind={a.kind} />;
  return <AppShell>{children}</AppShell>;
}
