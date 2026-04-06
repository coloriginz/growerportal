import { Suspense } from "react";
import { FustReceivedVouchers } from "@/features/fust/components";
import { Skeleton } from "@/components/ui/skeleton";

export default function FustPortalVouchersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FustReceivedVouchers />
    </Suspense>
  );
}
