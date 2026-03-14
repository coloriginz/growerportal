import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminContent } from "./admin-content";

export default async function AdminPage() {
  const session = await auth();

  if (session?.user.role !== "admin") {
    redirect("/dashboard");
  }

  return <AdminContent />;
}
