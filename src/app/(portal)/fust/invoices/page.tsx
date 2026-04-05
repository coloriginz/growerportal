import { Suspense } from "react";
import { FustFinance } from "@/features/fust/components";
import { Skeleton } from "@/components/ui/skeleton";

export default function FustInvoicesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FustFinance />
    </Suspense>
  );
}
