import { Suspense } from "react";
import { FustOrders } from "@/features/fust/components";
import { Skeleton } from "@/components/ui/skeleton";

export default function FustPortalOrdersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FustOrders />
    </Suspense>
  );
}
