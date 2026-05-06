import { Suspense } from "react";
import { getActiveSupplierId } from "@/lib/supplier-context";
import { DocumentsContent } from "./documents-content";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DocumentsPage({ searchParams }: Props) {
  const params = await searchParams;
  const supplierId = await getActiveSupplierId(params);

  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <DocumentsContent supplierId={supplierId} />
    </Suspense>
  );
}
