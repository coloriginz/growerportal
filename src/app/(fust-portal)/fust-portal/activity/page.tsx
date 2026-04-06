import { Suspense } from "react";
import { FustAuditLog } from "@/features/fust/components";
import { Skeleton } from "@/components/ui/skeleton";

export default function FustPortalActivityPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FustAuditLog />
    </Suspense>
  );
}
