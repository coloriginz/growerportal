import { Suspense } from "react";
import { FustInvoicing } from "@/features/fust/components";
import { Skeleton } from "@/components/ui/skeleton";

export default function FustPortalInvoicesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FustInvoicing />
    </Suspense>
  );
}
