import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { FustSettings } from "@/features/fust/components";
import { Skeleton } from "@/components/ui/skeleton";

export default async function FustPortalSettingsPage() {
  const session = await auth();
  if (session?.user.role !== "admin") {
    redirect("/fust-portal");
  }

  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FustSettings />
    </Suspense>
  );
}
