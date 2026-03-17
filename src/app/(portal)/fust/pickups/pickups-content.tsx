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
  RiAddLine,
  RiCheckLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiBox3Line,
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
  items: FustOrderItem[];
  grower: Grower;
}

interface FustDeliveryItem {
  id: string;
  fustTypeId: string;
  quantity: number;
  fustType: FustType;
}

interface FustDelivery {
  id: string;
  orderId: string;
  status: string;
  deliveredAt: string | null;
  notes: string | null;
  order: FustOrder;
  items: FustDeliveryItem[];
}

interface Transporter {
  id: string;
  name: string;
}

interface FustPickup {
  id: string;
  transporterId: string;
  transporter: Transporter;
  pickupDate: string;
  status: string;
  rfhReference: string | null;
  notes: string | null;
  deliveries: FustDelivery[];
}

// ─── Status Badge ───

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const statusMap: Record<
    string,
    { variant: "default" | "secondary" | "destructive" | "outline"; key: string }
  > = {
    planned: { variant: "outline", key: "fust.pending" },
    picked_up: { variant: "secondary", key: "fust.inTransit" },
    completed: { variant: "default", key: "fust.delivered" },
    pending: { variant: "outline", key: "fust.pending" },
    in_transit: { variant: "secondary", key: "fust.inTransit" },
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

export function PickupsContent() {
  const { t } = useLanguage();
  const [dateFilter, setDateFilter] = useState("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newPickupDate, setNewPickupDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [newPickupNotes, setNewPickupNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [expandedPickups, setExpandedPickups] = useState<Set<string>>(new Set());

  // Delivery dialog state
  const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false);
  const [activeDelivery, setActiveDelivery] = useState<FustDelivery | null>(null);
  const [deliveryQuantities, setDeliveryQuantities] = useState<
    Record<string, number>
  >({});
  const [confirmingDelivery, setConfirmingDelivery] = useState(false);

  // Order selection for new pickup
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

  const pickupsUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFilter) params.set("date", dateFilter);
    const qs = params.toString();
    return `/api/fust/pickups${qs ? `?${qs}` : ""}`;
  }, [dateFilter]);

  const {
    data: pickups,
    loading,
    refetch: refetchPickups,
  } = useFetch<FustPickup[]>(pickupsUrl);

  // Fetch approved orders that can be added to a pickup
  const { data: availableOrders } = useFetch<FustOrder[]>(
    "/api/fust/orders?status=approved"
  );

  const toggleExpand = useCallback((pickupId: string) => {
    setExpandedPickups((prev) => {
      const next = new Set(prev);
      if (next.has(pickupId)) {
        next.delete(pickupId);
      } else {
        next.add(pickupId);
      }
      return next;
    });
  }, []);

  const toggleOrderSelection = useCallback((orderId: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }, []);

  const handleCreatePickup = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/fust/pickups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickupDate: newPickupDate,
          notes: newPickupNotes || null,
          orderIds: Array.from(selectedOrderIds),
        }),
      });

      if (res.ok) {
        toast.success(t("fust.pickupCreated" as Parameters<typeof t>[0]));
        setShowNewDialog(false);
        setNewPickupDate(new Date().toISOString().split("T")[0]);
        setNewPickupNotes("");
        setSelectedOrderIds(new Set());
        refetchPickups();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to create pickup");
      }
    } catch {
      toast.error("Failed to create pickup");
    } finally {
      setCreating(false);
    }
  };

  const handleMarkPickedUp = async (pickupId: string) => {
    try {
      const res = await fetch(`/api/fust/pickups/${pickupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "picked_up" }),
      });

      if (res.ok) {
        toast.success(t("fust.pickupUpdated" as Parameters<typeof t>[0]));
        refetchPickups();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to update pickup");
      }
    } catch {
      toast.error("Failed to update pickup");
    }
  };

  const openDeliveryDialog = useCallback((delivery: FustDelivery) => {
    setActiveDelivery(delivery);
    // Pre-fill quantities from order items
    const quantities: Record<string, number> = {};
    for (const item of delivery.order.items) {
      // If delivery items exist, use those; otherwise use ordered quantities
      const deliveryItem = delivery.items.find(
        (di) => di.fustTypeId === item.fustTypeId
      );
      quantities[item.fustTypeId] = deliveryItem
        ? deliveryItem.quantity
        : item.quantity;
    }
    setDeliveryQuantities(quantities);
    setDeliveryDialogOpen(true);
  }, []);

  const handleConfirmDelivery = async () => {
    if (!activeDelivery) return;
    setConfirmingDelivery(true);
    try {
      const items = Object.entries(deliveryQuantities).map(
        ([fustTypeId, quantity]) => ({
          fustTypeId,
          quantity,
        })
      );

      const res = await fetch(`/api/fust/deliveries/${activeDelivery.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "delivered",
          items,
        }),
      });

      if (res.ok) {
        toast.success(
          t("fust.deliveryConfirmed" as Parameters<typeof t>[0])
        );
        setDeliveryDialogOpen(false);
        setActiveDelivery(null);
        refetchPickups();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to confirm delivery");
      }
    } catch {
      toast.error("Failed to confirm delivery");
    } finally {
      setConfirmingDelivery(false);
    }
  };

  const plannedPickups = useMemo(
    () => pickups?.filter((p) => p.status === "planned" || p.status === "picked_up") || [],
    [pickups]
  );

  const completedPickups = useMemo(
    () => pickups?.filter((p) => p.status === "completed") || [],
    [pickups]
  );

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("fust.pickups" as Parameters<typeof t>[0])}
        </h1>
        <div className="flex items-center gap-3">
          <Input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="h-9 w-auto"
          />
          {dateFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDateFilter("")}
            >
              {t("common.all")}
            </Button>
          )}
          <Button onClick={() => setShowNewDialog(true)}>
            <RiAddLine className="mr-1.5 h-4 w-4" />
            {t("fust.newPickup" as Parameters<typeof t>[0])}
          </Button>
        </div>
      </div>

      {/* Active / Planned Pickups */}
      {plannedPickups.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">
            {t("fust.plannedPickups" as Parameters<typeof t>[0])}
          </h2>
          <div className="space-y-4">
            {plannedPickups.map((pickup) => (
              <PickupCard
                key={pickup.id}
                pickup={pickup}
                expanded={expandedPickups.has(pickup.id)}
                onToggleExpand={() => toggleExpand(pickup.id)}
                onMarkPickedUp={() => handleMarkPickedUp(pickup.id)}
                onDeliverOrder={openDeliveryDialog}
                t={t}
              />
            ))}
          </div>
        </section>
      )}

      {/* Completed Pickups */}
      {completedPickups.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">
            {t("fust.completedPickups" as Parameters<typeof t>[0])}
          </h2>
          <div className="space-y-4">
            {completedPickups.map((pickup) => (
              <PickupCard
                key={pickup.id}
                pickup={pickup}
                expanded={expandedPickups.has(pickup.id)}
                onToggleExpand={() => toggleExpand(pickup.id)}
                onMarkPickedUp={() => {}}
                onDeliverOrder={openDeliveryDialog}
                t={t}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {(!pickups || pickups.length === 0) && (
        <div className="py-12 text-center text-muted-foreground">
          <RiTruckLine className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p>{t("fust.noPickups" as Parameters<typeof t>[0])}</p>
        </div>
      )}

      {/* New Pickup Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("fust.newPickup" as Parameters<typeof t>[0])}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                {t("fust.pickupDate" as Parameters<typeof t>[0])}
              </label>
              <Input
                type="date"
                value={newPickupDate}
                onChange={(e) => setNewPickupDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                {t("fust.notes")}
              </label>
              <Input
                value={newPickupNotes}
                onChange={(e) => setNewPickupNotes(e.target.value)}
                placeholder={t("fust.notes")}
              />
            </div>

            {/* Order selection */}
            {availableOrders && availableOrders.length > 0 && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  {t("fust.selectOrders" as Parameters<typeof t>[0])}
                </label>
                <div className="max-h-60 space-y-2 overflow-y-auto rounded-md border p-2">
                  {availableOrders.map((order) => (
                    <label
                      key={order.id}
                      className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={selectedOrderIds.has(order.id)}
                        onChange={() => toggleOrderSelection(order.id)}
                        className="h-4 w-4 rounded border-input"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {order.orderNumber} - {order.grower.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {order.items
                            .map((i) => `${i.quantity}x ${i.fustType.name}`)
                            .join(", ")}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowNewDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleCreatePickup} disabled={creating}>
              {creating
                ? t("common.loading")
                : t("fust.newPickup" as Parameters<typeof t>[0])}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delivery Confirmation Dialog */}
      <Dialog open={deliveryDialogOpen} onOpenChange={setDeliveryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("fust.confirmDelivery")} - {activeDelivery?.order.orderNumber}
            </DialogTitle>
          </DialogHeader>
          {activeDelivery && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                {activeDelivery.order.grower.name}
                {activeDelivery.order.grower.company &&
                  ` (${activeDelivery.order.grower.company})`}
              </p>
              <div className="space-y-3">
                {activeDelivery.order.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-4 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.fustType.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("fust.ordered")}: {formatNumber(item.quantity)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground">
                        {t("fust.actualQuantity" as Parameters<typeof t>[0])}
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
            <Button
              variant="outline"
              onClick={() => setDeliveryDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleConfirmDelivery}
              disabled={confirmingDelivery}
            >
              {confirmingDelivery
                ? t("common.loading")
                : t("fust.markDelivered" as Parameters<typeof t>[0])}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Pickup Card Component ───

interface PickupCardProps {
  pickup: FustPickup;
  expanded: boolean;
  onToggleExpand: () => void;
  onMarkPickedUp: () => void;
  onDeliverOrder: (delivery: FustDelivery) => void;
  t: ReturnType<typeof useLanguage>["t"];
}

function PickupCard({
  pickup,
  expanded,
  onToggleExpand,
  onMarkPickedUp,
  onDeliverOrder,
  t,
}: PickupCardProps) {
  const deliveryCount = pickup.deliveries.length;
  const deliveredCount = pickup.deliveries.filter(
    (d) => d.status === "delivered"
  ).length;

  return (
    <Card className="overflow-hidden">
      {/* Card Header */}
      <div
        className="flex cursor-pointer items-center justify-between p-4"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <RiTruckLine className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium">{formatDate(pickup.pickupDate)}</p>
              <StatusBadge status={pickup.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("fust.transporter" as Parameters<typeof t>[0])}:{" "}
              {pickup.transporter.name}
              {pickup.rfhReference && ` | RFH: ${pickup.rfhReference}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("fust.linkedOrders" as Parameters<typeof t>[0])}: {deliveryCount}
              {deliveryCount > 0 && ` (${deliveredCount}/${deliveryCount} ${t("fust.delivered")})`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pickup.status === "planned" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                onMarkPickedUp();
              }}
            >
              <RiCheckLine className="mr-1 h-3.5 w-3.5" />
              {t("fust.markPickedUp" as Parameters<typeof t>[0])}
            </Button>
          )}
          {expanded ? (
            <RiArrowUpSLine className="h-5 w-5 text-muted-foreground" />
          ) : (
            <RiArrowDownSLine className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded: Linked Orders */}
      {expanded && pickup.deliveries.length > 0 && (
        <div className="border-t bg-muted/30 p-4">
          <div className="space-y-3">
            {pickup.deliveries.map((delivery) => (
              <div
                key={delivery.id}
                className="rounded-lg border bg-card p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">
                        {delivery.order.orderNumber}
                      </p>
                      <StatusBadge status={delivery.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {delivery.order.grower.name}
                      {delivery.order.grower.company &&
                        ` - ${delivery.order.grower.company}`}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {delivery.order.items.map((item) => {
                        const deliveryItem = delivery.items.find(
                          (di) => di.fustTypeId === item.fustTypeId
                        );
                        return (
                          <span
                            key={item.id}
                            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                          >
                            <RiBox3Line className="h-3 w-3" />
                            {item.quantity}x {item.fustType.name}
                            {deliveryItem && delivery.status === "delivered" && (
                              <span className="text-muted-foreground">
                                ({t("fust.actualDelivered")}: {deliveryItem.quantity})
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                    {delivery.deliveredAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("fust.delivered")}: {formatDate(delivery.deliveredAt)}
                      </p>
                    )}
                  </div>
                  {delivery.status !== "delivered" &&
                    pickup.status === "picked_up" && (
                      <Button
                        size="sm"
                        onClick={() => onDeliverOrder(delivery)}
                      >
                        <RiCheckLine className="mr-1 h-3.5 w-3.5" />
                        {t("fust.markDelivered" as Parameters<typeof t>[0])}
                      </Button>
                    )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expanded: No orders */}
      {expanded && pickup.deliveries.length === 0 && (
        <div className="border-t bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          {t("fust.noOrders")}
        </div>
      )}

      {/* Notes */}
      {expanded && pickup.notes && (
        <div className="border-t px-4 py-2 text-sm text-muted-foreground">
          {t("fust.notes")}: {pickup.notes}
        </div>
      )}
    </Card>
  );
}
