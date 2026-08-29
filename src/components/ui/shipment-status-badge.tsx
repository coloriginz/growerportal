"use client";

import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/providers/language-provider";
import type { ShipmentStatus } from "@/lib/shipment-status";

const STATUS_CLASSES: Record<ShipmentStatus, string> = {
  selling:
    "bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400",
  finalizing:
    "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400",
  completed:
    "bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400",
};

const STATUS_LABEL_KEYS = {
  selling: "shipments.statusSelling",
  finalizing: "shipments.statusFinalizing",
  completed: "shipments.statusCompleted",
} as const;

export function ShipmentStatusBadge({
  status,
  className,
}: {
  status: ShipmentStatus;
  className?: string;
}) {
  const { t } = useLanguage();
  return (
    <Badge className={`${STATUS_CLASSES[status]} ${className ?? ""}`}>
      {t(STATUS_LABEL_KEYS[status])}
    </Badge>
  );
}
