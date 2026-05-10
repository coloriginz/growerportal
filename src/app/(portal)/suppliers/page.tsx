import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { SuppliersContent } from "./suppliers-content";

export default async function SuppliersPage() {
  const session = await auth();

  if (!session?.user || session.user.role === "supplier") {
    redirect("/dashboard");
  }

  return (
    <Suspense>
      <SuppliersContent isAdmin={session.user.role === "admin"} />
    </Suspense>
  );
}
