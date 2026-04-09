"use client";

import { useState, useMemo } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatCurrencyDetailed, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RiBox3Line, RiHistoryLine, RiCheckboxCircleLine } from "@remixicon/react";
import { FustOrderTimeline } from "./fust-order-timeline";

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
  const statusMap: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; key: string; className?: string }> = {
    pending: { variant: "default", key: "fust.pending", className: "bg-orange-500 text-white border-orange-500 hover:bg-orange-500/80" },
    approved: { variant: "outline", key: "fust.toBeDelivered", className: "border-green-600 text-green-700 dark:text-green-400 dark:border-green-500" },
    rejected: { variant: "destructive", key: "fust.rejected" },
    scheduled: { variant: "secondary", key: "fust.scheduled" },
    in_transit: { variant: "secondary", key: "fust.inTransit" },
    delivered: { variant: "default", key: "fust.delivered" },
    cancelled: { variant: "destructive", key: "fust.cancelled" },
  };
  const config = statusMap[status] || { variant: "outline" as const, key: status };
  return <Badge variant={config.variant} className={config.className}>{t(config.key as Parameters<typeof t>[0])}</Badge>;
}

interface FustMyOrdersProps {
  growerId: string | null;
}

export function FustMyOrders({ growerId }: FustMyOrdersProps) {
  const { t } = useLanguage();
  const [timelineOrder, setTimelineOrder] = useState<FustOrder | null>(null);

  const ordersUrl = useMemo(() => {
    if (growerId) return `/api/fust/orders?growerId=${growerId}`;
    return "/api/fust/orders";
  }, [growerId]);

  const { data: orders, loading } = useFetch<FustOrder[]>(ordersUrl);

  const activeOrders = useMemo(
    () => orders?.filter((o) => o.status !== "delivered") || [],
    [orders]
  );

  const deliveredOrders = useMemo(
    () => orders?.filter((o) => o.status === "delivered") || [],
    [orders]
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">
        {t("fust.tabMyOrders")}
      </h1>

      {loading ? (
        <Skeleton className="h-48" />
      ) : (
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">
              {t("fust.activeOrders" as Parameters<typeof t>[0])}
              {activeOrders.length > 0 && (
                <Badge variant="default" className="ml-1.5 h-5 min-w-5 px-1.5">
                  {activeOrders.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="delivered">
              {t("fust.delivered")}
              {deliveredOrders.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5">
                  {deliveredOrders.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            <OrdersTable
              orders={activeOrders}
              onTimeline={setTimelineOrder}
              t={t}
              emptyIcon={<RiBox3Line className="mx-auto mb-3 h-10 w-10 opacity-30" />}
              emptyMessage={t("fust.noOrders")}
            />
          </TabsContent>

          <TabsContent value="delivered">
            <OrdersTable
              orders={deliveredOrders}
              onTimeline={setTimelineOrder}
              t={t}
              emptyIcon={<RiCheckboxCircleLine className="mx-auto mb-3 h-10 w-10 opacity-30" />}
              emptyMessage={t("fust.noCompletedDeliveries" as Parameters<typeof t>[0])}
            />
          </TabsContent>
        </Tabs>
      )}

      {/* Order timeline sheet */}
      <Sheet open={!!timelineOrder} onOpenChange={(open) => { if (!open) setTimelineOrder(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("fust.orderTimeline")} — {timelineOrder?.orderNumber}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            {timelineOrder && <FustOrderTimeline orderId={timelineOrder.id} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Extracted Orders Table ───

interface OrdersTableProps {
  orders: FustOrder[];
  onTimeline: (order: FustOrder) => void;
  t: ReturnType<typeof useLanguage>["t"];
  emptyIcon: React.ReactNode;
  emptyMessage: string;
}

function OrdersTable({ orders, onTimeline, t, emptyIcon, emptyMessage }: OrdersTableProps) {
  if (orders.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        {emptyIcon}
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
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
            <TableHead />
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
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => onTimeline(order)}
                    title={t("fust.history")}
                  >
                    <RiHistoryLine className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
