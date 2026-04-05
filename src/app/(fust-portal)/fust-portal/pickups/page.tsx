import { Suspense } from "react";
import { FustDeliveries } from "@/features/fust/components";
import { Skeleton } from "@/components/ui/skeleton";

export default function FustPortalPickupsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FustDeliveries />
    </Suspense>
  );
}
