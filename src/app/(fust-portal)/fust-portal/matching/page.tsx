import { Suspense } from "react";
import { VoucherMatching } from "@/features/fust/components";
import { Skeleton } from "@/components/ui/skeleton";

export default function FustPortalMatchingPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <div className="space-y-4">
        <VoucherMatching />
      </div>
    </Suspense>
  );
}
