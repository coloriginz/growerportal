"use client";

import { useState, useMemo, useCallback } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatDate, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  RiTruckLine,
  RiCheckLine,
} from "@remixicon/react";
import { toast } from "sonner";

// ─── Types ───

interface FustType {
  id: string;
  code: string;
  name: string;
  category: string;
  pricePerUnit: string;
}

interface FustOrderItem {
  id: string;
  fustTypeId: string;
  quantity: number;
  deliveredQuantity: number | null;
  fustType: FustType;
}

interface Grower {
  id: string;
  code: string;
  name: string;
  company: string | null;
}

interface FustOrder {
  id: string;
  orderNumber: string;
  status: string;
  requestedDate: string | null;
  notes: string | null;
  deliveredAt: string | null;
  items: FustOrderItem[];
  grower: Grower;
}

// ─── Status Badge ───

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const statusMap: Record<
    string,
    { variant: "default" | "secondary" | "destructive" | "outline"; key: string }
  > = {
    approved: { variant: "secondary", key: "fust.approved" },
    delivered: { variant: "default", key: "fust.delivered" },
  };
  const config = statusMap[status] || { variant: "outline" as const, key: status };
  return (
    <Badge variant={config.variant}>
      {t(config.key as Parameters<typeof t>[0])}
    </Badge>
  );
}

// ─── Main Component ───

export function FustDeliveries() {
  const { t } = useLanguage();

  // Confirm delivery dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeOrder, setActiveOrder] = useState<FustOrder | null>(null);
  const [deliveryQuantities, setDeliveryQuantities] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);

  const { data: orders, loading, refetch } = useFetch<FustOrder[]>("/api/fust/orders");

  const pendingOrders = useMemo(
    () => orders?.filter((o) => o.status === "approved") || [],
    [orders]
  );

  const completedOrders = useMemo(
    () => orders?.filter((o) => o.status === "delivered") || [],
    [orders]
  );

  const openConfirmDialog = useCallback((order: FustOrder) => {
    setActiveOrder(order);
    const quantities: Record<string, number> = {};
    for (const item of order.items) {
      quantities[item.fustTypeId] = item.quantity;
    }
    setDeliveryQuantities(quantities);
    setDialogOpen(true);
  }, []);

  const handleConfirmDelivery = async () => {
    if (!activeOrder) return;
    setConfirming(true);
    try {
      const items = Object.entries(deliveryQuantities).map(
        ([fustTypeId, deliveredQuantity]) => ({ fustTypeId, deliveredQuantity })
      );

      const res = await fetch(`/api/fust/orders/${activeOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "delivered", items }),
      });

      if (res.ok) {
        toast.success(t("fust.deliveryConfirmed" as Parameters<typeof t>[0]));
        setDialogOpen(false);
        setActiveOrder(null);
        refetch();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to confirm delivery");
      }
    } catch {
      toast.error("Failed to confirm delivery");
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-2xl font-bold tracking-tight">
        {t("fust.deliveries" as Parameters<typeof t>[0])}
      </h1>

      {/* Pending Deliveries */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">
          {t("fust.pendingDeliveries" as Parameters<typeof t>[0])}
        </h2>
        {pendingOrders.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <RiTruckLine className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p>{t("fust.noDeliveriesPending" as Parameters<typeof t>[0])}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onConfirm={() => openConfirmDialog(order)}
                t={t}
              />
            ))}
          </div>
        )}
      </section>

      {/* Completed Deliveries */}
      {completedOrders.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">
            {t("fust.completedDeliveries" as Parameters<typeof t>[0])}
          </h2>
          <div className="space-y-3">
            {completedOrders.map((order) => (
              <OrderCard key={order.id} order={order} t={t} />
            ))}
          </div>
        </section>
      )}

      {/* Confirm Delivery Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("fust.confirmDeliveryTitle" as Parameters<typeof t>[0])} — {activeOrder?.orderNumber}
            </DialogTitle>
          </DialogHeader>
          {activeOrder && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                {activeOrder.grower.name}
                {activeOrder.grower.company && ` (${activeOrder.grower.company})`}
              </p>
              <div className="space-y-3">
                {activeOrder.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-4 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        <span className="font-mono text-primary">{item.fustType.code}</span>{" "}
                        {item.fustType.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("fust.orderedQuantity" as Parameters<typeof t>[0])}: {formatNumber(item.quantity)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground">
                        {t("fust.deliveredQuantity" as Parameters<typeof t>[0])}
                      </label>
                      <Input
                        type="number"
                        min={0}
                        value={deliveryQuantities[item.fustTypeId] ?? item.quantity}
                        onChange={(e) =>
                          setDeliveryQuantities((prev) => ({
                            ...prev,
                            [item.fustTypeId]: parseInt(e.target.value) || 0,
                          }))
                        }
                        className="h-8 w-20 text-center text-sm"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleConfirmDelivery} disabled={confirming}>
              {confirming
                ? t("common.loading")
                : t("fust.confirmAndDeliver" as Parameters<typeof t>[0])}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Order Card Component ───

interface OrderCardProps {
  order: FustOrder;
  onConfirm?: () => void;
  t: ReturnType<typeof useLanguage>["t"];
}

function OrderCard({ order, onConfirm, t }: OrderCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium">{order.orderNumber}</p>
            <StatusBadge status={order.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {order.grower.name}
            {order.grower.company && ` — ${order.grower.company}`}
          </p>
          {order.requestedDate && (
            <p className="text-xs text-muted-foreground">
              {t("fust.requestedDate")}: {formatDate(order.requestedDate)}
            </p>
          )}
          <div className="mt-2 space-y-1">
            {order.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 text-sm"
              >
                <span className="font-mono text-xs font-semibold text-primary w-16 shrink-0">{item.fustType.code}</span>
                <span className="flex-1 truncate">{item.fustType.name}</span>
                <span className="font-medium tabular-nums">{item.quantity}x</span>
                {item.deliveredQuantity != null && order.status === "delivered" && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ({t("fust.deliveredQuantity" as Parameters<typeof t>[0])}: {formatNumber(item.deliveredQuantity)})
                  </span>
                )}
              </div>
            ))}
          </div>
          {order.notes && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t("fust.notes")}: {order.notes}
            </p>
          )}
          {order.deliveredAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("fust.delivered")}: {formatDate(order.deliveredAt)}
            </p>
          )}
        </div>
        {onConfirm && order.status === "approved" && (
          <Button size="sm" onClick={onConfirm}>
            <RiCheckLine className="mr-1.5 h-3.5 w-3.5" />
            {t("fust.confirmDelivery")}
          </Button>
        )}
      </div>
    </Card>
  );
}
