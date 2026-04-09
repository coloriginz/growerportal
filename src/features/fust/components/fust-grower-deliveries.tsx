"use client";

import { useMemo } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatDate, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RiBox3Line } from "@remixicon/react";

interface FustType {
  id: string;
  code: string;
  name: string;
  category: string;
  pricePerUnit: string;
  imageUrl: string | null;
  sortOrder: number;
}

interface FustOrderItem {
  id: string;
  fustTypeId: string;
  quantity: number;
  fustType: FustType;
}

interface FustDeliveryItem {
  id: string;
  fustTypeId: string;
  quantity: number;
  fustType: FustType;
}

interface FustOrder {
  id: string;
  orderNumber: string;
  status: string;
  requestedDate: string | null;
  notes: string | null;
  rejectionReason: string | null;
  createdAt: string;
  items: FustOrderItem[];
  delivery?: {
    id: string;
    status: string;
    deliveredAt: string | null;
    items?: FustDeliveryItem[];
  } | null;
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const statusMap: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; key: string; className?: string }> = {
    pending: { variant: "default", key: "fust.pending", className: "bg-orange-500 text-white border-orange-500 hover:bg-orange-500/80" },
    approved: { variant: "outline", key: "fust.approved", className: "border-green-600 text-green-700 dark:text-green-400 dark:border-green-500" },
    rejected: { variant: "destructive", key: "fust.rejected" },
    scheduled: { variant: "secondary", key: "fust.scheduled" },
    in_transit: { variant: "secondary", key: "fust.inTransit" },
    delivered: { variant: "default", key: "fust.delivered" },
    cancelled: { variant: "destructive", key: "fust.cancelled" },
  };
  const config = statusMap[status] || { variant: "outline" as const, key: status };
  return <Badge variant={config.variant} className={config.className}>{t(config.key as Parameters<typeof t>[0])}</Badge>;
}

interface FustGrowerDeliveriesProps {
  growerId: string | null;
}

export function FustGrowerDeliveries({ growerId }: FustGrowerDeliveriesProps) {
  const { t } = useLanguage();

  const ordersUrl = useMemo(() => {
    if (growerId) return `/api/fust/orders?growerId=${growerId}`;
    return "/api/fust/orders";
  }, [growerId]);

  const { data: orders, loading } = useFetch<FustOrder[]>(ordersUrl);

  const deliveredOrders = useMemo(
    () => orders?.filter((o) => o.status === "delivered") || [],
    [orders]
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">
        {t("fust.tabDeliveries")}
      </h1>

      {loading ? (
        <Skeleton className="h-48" />
      ) : deliveredOrders.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <RiBox3Line className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p>{t("fust.noDeliveries")}</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fust.orderNumber")}</TableHead>
                <TableHead>{t("fust.delivery")}</TableHead>
                <TableHead>{t("fust.status")}</TableHead>
                <TableHead>{t("fust.items")}</TableHead>
                <TableHead>{t("fust.ordered")} / {t("fust.actualDelivered")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveredOrders.map((order) => {
                const hasDeliveryItems = order.delivery?.items && order.delivery.items.length > 0;
                return (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.orderNumber}</TableCell>
                    <TableCell>
                      {order.delivery?.deliveredAt
                        ? formatDate(order.delivery.deliveredAt)
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={order.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {order.items.map((item) => (
                          <span key={item.id} className="text-xs">
                            {formatNumber(item.quantity)}x {item.fustType.name}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {hasDeliveryItems ? (
                        <div className="flex flex-col gap-0.5">
                          {order.items.map((item) => {
                            const deliveryItem = order.delivery?.items?.find(
                              (di) => di.fustTypeId === item.fustTypeId
                            );
                            const delivered = deliveryItem?.quantity ?? 0;
                            const differs = delivered !== item.quantity;
                            return (
                              <span
                                key={item.id}
                                className={`text-xs ${differs ? "font-medium text-amber-600" : ""}`}
                              >
                                {formatNumber(item.quantity)} / {formatNumber(delivered)}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
