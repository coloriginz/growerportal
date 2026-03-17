import { Suspense } from "react";
import { InvoicesContent } from "./invoices-content";
import { Skeleton } from "@/components/ui/skeleton";

export default function FustInvoicesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <InvoicesContent />
    </Suspense>
  );
}
