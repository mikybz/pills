import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AdminScreen } from "@/components/admin-screen";

export default async function AdminPage() {
  const user = await currentUser();
  if (!user?.isAdmin) redirect("/settings");
  return <AdminScreen selfId={user.id} />;
}
