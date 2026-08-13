import { Suspense } from "react";
import { RfhInvoiceDetail } from "@/features/fust/components/rfh-invoice-detail";

export default async function RfhInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <RfhInvoiceDetail invoiceId={id} />
    </Suspense>
  );
}
