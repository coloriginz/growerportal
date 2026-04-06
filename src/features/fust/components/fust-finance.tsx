"use client";

import { useState } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { VoucherMatching } from "./voucher-matching";
import { FustInvoices } from "./fust-invoices";

export function FustFinance() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<"vouchers" | "invoices">("vouchers");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">
        {activeTab === "vouchers"
          ? t("fust.matchingView" as Parameters<typeof t>[0])
          : t("fust.invoices" as Parameters<typeof t>[0])}
      </h1>

      {/* Tab bar */}
      <div className="flex border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "vouchers"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("vouchers")}
        >
          {t("fust.tabVouchers" as Parameters<typeof t>[0])}
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "invoices"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("invoices")}
        >
          {t("fust.tabInvoices" as Parameters<typeof t>[0])}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "vouchers" ? <VoucherMatching /> : <FustInvoices />}
    </div>
  );
}
