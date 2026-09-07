import { Suspense } from "react";
import { getActiveSupplierId } from "@/lib/supplier-context";
import { LotsContent } from "./lots-content";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LotsPage({ searchParams }: Props) {
  const params = await searchParams;
  const supplierId = await getActiveSupplierId(params);

  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      {/* key op de leverancier: bij wisselen begint de lijst weer op pagina 1
          in plaats van op het paginanummer van de vorige leverancier. */}
      <LotsContent key={supplierId ?? "none"} supplierId={supplierId} />
    </Suspense>
  );
}
