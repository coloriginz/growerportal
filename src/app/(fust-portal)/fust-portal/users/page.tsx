import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { UserManagement } from "@/components/layout/user-management";

export default async function FustPortalUsersPage() {
  const session = await auth();
  if (session?.user.role !== "admin") {
    redirect("/fust-portal");
  }

  return (
    <UserManagement
      allowedRoles={["admin", "commercie", "transporteur", "finance"]}
    />
  );
}
