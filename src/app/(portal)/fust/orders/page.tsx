import { Suspense } from "react";
import { FustOrdersContent } from "./fust-orders-content";
import { Skeleton } from "@/components/ui/skeleton";

export default function FustOrdersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FustOrdersContent />
    </Suspense>
  );
}
