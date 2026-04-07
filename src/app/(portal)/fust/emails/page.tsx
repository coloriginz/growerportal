import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { FustEmailLog } from "@/features/fust/components/fust-email-log";

export default function FustEmailsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FustEmailLog />
    </Suspense>
  );
}
