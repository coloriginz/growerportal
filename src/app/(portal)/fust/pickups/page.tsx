import { Suspense } from "react";
import { PickupsContent } from "./pickups-content";
import { Skeleton } from "@/components/ui/skeleton";

export default function PickupsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <PickupsContent />
    </Suspense>
  );
}
