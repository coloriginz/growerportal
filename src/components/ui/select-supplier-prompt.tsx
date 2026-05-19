"use client";

import { RiUserSearchLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";

export function SelectSupplierPrompt() {
  const { t } = useLanguage();
  return (
    <div className="page-content">
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent mb-4">
          <RiUserSearchLine className="h-8 w-8 text-accent-foreground" />
        </div>
        <h2 className="text-lg font-semibold">{t("dashboard.selectSupplierTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">
          {t("dashboard.selectSupplierDescription")}
        </p>
      </div>
    </div>
  );
}
