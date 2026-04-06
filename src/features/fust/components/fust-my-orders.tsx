"use client";

import { useMemo } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatCurrencyDetailed, formatDate } from "@/lib/format";
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

interface FustOrder {
  id: string;
  orderNumber: string;
  status: string;
  requestedDate: string | null;
  notes: string | null;
  rejectionReason: string | null;
  createdAt: string;
  items: FustOrderItem[];
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const statusMap: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; key: string }> = {
    pending: { variant: "outline", key: "fust.pending" },
    approved: { variant: "default", key: "fust.toBeDelivered" },
    rejected: { variant: "destructive", key: "fust.rejected" },
    scheduled: { variant: "secondary", key: "fust.scheduled" },
    in_transit: { variant: "secondary", key: "fust.inTransit" },
    delivered: { variant: "default", key: "fust.delivered" },
    cancelled: { variant: "destructive", key: "fust.cancelled" },
  };
  const config = statusMap[status] || { variant: "outline" as const, key: status };
  return <Badge variant={config.variant}>{t(config.key as Parameters<typeof t>[0])}</Badge>;
}

interface FustMyOrdersProps {
  growerId: string | null;
}

export function FustMyOrders({ growerId }: FustMyOrdersProps) {
  const { t } = useLanguage();

  const ordersUrl = useMemo(() => {
    if (growerId) return `/api/fust/orders?growerId=${growerId}`;
    return "/api/fust/orders";
  }, [growerId]);

  const { data: orders, loading } = useFetch<FustOrder[]>(ordersUrl);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">
        {t("fust.tabMyOrders")}
      </h1>

      {loading ? (
        <Skeleton className="h-48" />
      ) : !orders || orders.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <RiBox3Line className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p>{t("fust.noOrders")}</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fust.orderNumber")}</TableHead>
                <TableHead>{t("fust.createdAt")}</TableHead>
                <TableHead>{t("fust.requestedDate")}</TableHead>
                <TableHead>{t("fust.status")}</TableHead>
                <TableHead>{t("fust.items")}</TableHead>
                <TableHead className="text-right">{t("fust.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const total = order.items.reduce(
                  (sum, item) => sum + Number(item.fustType.pricePerUnit) * item.quantity,
                  0
                );
                return (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.orderNumber}</TableCell>
                    <TableCell>{formatDate(order.createdAt)}</TableCell>
                    <TableCell>
                      {order.requestedDate ? formatDate(order.requestedDate) : "-"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={order.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {order.items.map((item) => (
                          <span key={item.id} className="text-xs">
                            {item.quantity}x {item.fustType.name}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrencyDetailed(total)}
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
