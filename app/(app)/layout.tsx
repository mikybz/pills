import { currentUser, devBypass } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  if (!user && !devBypass) redirect("/api/auth/signin");
  return <AppShell>{children}</AppShell>;
}
