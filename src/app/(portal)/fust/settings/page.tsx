import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { FustSettingsContent } from "./fust-settings-content";
import { Skeleton } from "@/components/ui/skeleton";

export default async function FustSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FustSettingsContent />
    </Suspense>
  );
}
