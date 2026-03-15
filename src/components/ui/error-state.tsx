"use client";

import { RiErrorWarningLine, RiRefreshLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/providers/language-provider";

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <RiErrorWarningLine className="h-6 w-6 text-destructive" />
      </div>
      <p className="text-sm text-muted-foreground">{t("common.failedToLoad")}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RiRefreshLine className="mr-2 h-4 w-4" />
        {t("common.retry")}
      </Button>
    </div>
  );
}
