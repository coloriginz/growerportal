import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getActiveSupplierId } from "@/lib/supplier-context";
import { FustWebshop } from "@/features/fust/components";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function FustPage({ searchParams }: Props) {
  const session = await auth();

  // Transporteur should land directly on pickups, not the webshop
  if (session?.user.role === "transporteur") {
    redirect("/fust/pickups");
  }

  // Finance should land on invoices
  if (session?.user.role === "finance") {
    redirect("/fust/invoices");
  }

  const params = await searchParams;
  const supplierId = await getActiveSupplierId(params);

  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FustWebshop supplierId={supplierId} userRole={session?.user.role} />
    </Suspense>
  );
}
