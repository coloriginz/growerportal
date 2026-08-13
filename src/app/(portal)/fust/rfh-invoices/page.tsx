import { Suspense } from "react";
import { RfhInvoices } from "@/features/fust/components/rfh-invoices";

export default function RfhInvoicesPage() {
  return (
    <Suspense>
      <RfhInvoices />
    </Suspense>
  );
}
