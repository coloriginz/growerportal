"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatCurrencyDetailed, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RiCheckLine, RiCloseLine, RiBox3Line, RiHistoryLine, RiLoader4Line } from "@remixicon/react";
import { toast } from "sonner";
import { FustOrderTimeline } from "./fust-order-timeline";

interface FustType {
  id: string;
  code: string;
  name: string;
  category: string;
  pricePerUnit: string;
}

interface FustOrderItem {
  id: string;
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
  supplier: {
    id: string;
    code: string;
    name: string;
    company: string | null;
  };
  delivery?: {
    id: string;
    status: string;
    deliveredAt: string | null;
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
  return (
    <Badge variant={config.variant} className={config.className}>
      {t(config.key as Parameters<typeof t>[0])}
    </Badge>
  );
}

export function FustOrders() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const supplierId = searchParams.get("supplierId");
  const [rejectDialogOrder, setRejectDialogOrder] = useState<FustOrder | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [timelineOrder, setTimelineOrder] = useState<FustOrder | null>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (supplierId) params.set("supplierId", supplierId);
    return `/api/fust/orders?${params.toString()}`;
  }, [supplierId]);

  const { data: orders, loading, refetch } = useFetch<FustOrder[]>(url);

  const activeOrders = useMemo(
    () => orders?.filter((o) => o.status === "pending" || o.status === "approved") || [],
    [orders]
  );

  const deliveredOrders = useMemo(
    () => orders?.filter((o) => o.status === "delivered") || [],
    [orders]
  );

  const otherOrders = useMemo(
    () => orders?.filter((o) => o.status === "rejected" || o.status === "cancelled") || [],
    [orders]
  );

  const handleApprove = async (order: FustOrder) => {
    setProcessing(order.id);
    try {
      const res = await fetch(`/api/fust/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.previewUrl) {
          toast.success(t("fust.orderApproved"), {
            description: "Ethereal preview available",
            action: {
              label: "Open",
              onClick: () => window.open(data.previewUrl, "_blank"),
            },
            duration: 15000,
          });
        } else {
          toast.success(t("fust.orderApproved"));
        }
        refetch();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to approve order");
      }
    } catch {
      toast.error("Failed to approve order");
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async () => {
    if (!rejectDialogOrder || !rejectionReason.trim()) return;
    setProcessing(rejectDialogOrder.id);
    try {
      const res = await fetch(`/api/fust/orders/${rejectDialogOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected", rejectionReason: rejectionReason.trim() }),
      });
      if (res.ok) {
        toast.success(t("fust.orderRejected"));
        setRejectDialogOrder(null);
        setRejectionReason("");
        refetch();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to reject order");
      }
    } catch {
      toast.error("Failed to reject order");
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("fust.title")}</h1>

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
            {otherOrders.length > 0 && (
              <TabsTrigger value="other">
                {t("fust.rejectedCancelled" as Parameters<typeof t>[0])}
                <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5">
                  {otherOrders.length}
                </Badge>
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="active">
            <OrdersTable
              orders={activeOrders}
              processing={processing}
              onApprove={handleApprove}
              onReject={(order) => { setRejectDialogOrder(order); setRejectionReason(""); }}
              onTimeline={setTimelineOrder}
              t={t}
              emptyMessage={t("fust.noOrders")}
            />
          </TabsContent>

          <TabsContent value="delivered">
            <OrdersTable
              orders={deliveredOrders}
              processing={processing}
              onTimeline={setTimelineOrder}
              t={t}
              emptyMessage={t("fust.noOrders")}
            />
          </TabsContent>

          {otherOrders.length > 0 && (
            <TabsContent value="other">
              <OrdersTable
                orders={otherOrders}
                processing={processing}
                onTimeline={setTimelineOrder}
                t={t}
                emptyMessage={t("fust.noOrders")}
              />
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Rejection reason dialog */}
      <Dialog
        open={!!rejectDialogOrder}
        onOpenChange={(open) => {
          if (!open) {
            setRejectDialogOrder(null);
            setRejectionReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("fust.rejectConfirm")}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="mb-2 text-sm text-muted-foreground">
              {rejectDialogOrder?.orderNumber} - {rejectDialogOrder?.supplier.code}
            </p>
            <Input
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder={t("fust.enterRejectionReason")}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOrder(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectionReason.trim() || processing === rejectDialogOrder?.id}
            >
              {processing === rejectDialogOrder?.id && (
                <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("fust.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
  processing: string | null;
  onApprove?: (order: FustOrder) => void;
  onReject?: (order: FustOrder) => void;
  onTimeline: (order: FustOrder) => void;
  t: ReturnType<typeof useLanguage>["t"];
  emptyMessage: string;
}

function OrdersTable({ orders, processing, onApprove, onReject, onTimeline, t, emptyMessage }: OrdersTableProps) {
  if (orders.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <RiBox3Line className="mx-auto mb-3 h-10 w-10 opacity-30" />
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("fust.orderNumber")}</TableHead>
            <TableHead>{t("fust.supplier")}</TableHead>
            <TableHead>{t("fust.createdAt")}</TableHead>
            <TableHead>{t("fust.requestedDate")}</TableHead>
            <TableHead>{t("fust.status")}</TableHead>
            <TableHead>{t("fust.items")}</TableHead>
            <TableHead className="text-right">{t("fust.total")}</TableHead>
            <TableHead>{t("common.actions")}</TableHead>
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
                <TableCell>
                  <div>
                    <p className="text-sm font-medium">{order.supplier.code}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.supplier.company || order.supplier.name}
                    </p>
                  </div>
                </TableCell>
                <TableCell>{formatDate(order.createdAt)}</TableCell>
                <TableCell>
                  {order.requestedDate ? formatDate(order.requestedDate) : "-"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={order.status} />
                  {order.rejectionReason && (
                    <p className="mt-1 text-xs text-destructive">{order.rejectionReason}</p>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    {order.items.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-semibold text-primary">{item.fustType.code}</span>
                        <span className="truncate">{item.fustType.name}</span>
                        <span className="font-medium">{item.quantity}x</span>
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrencyDetailed(total)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {order.status === "pending" && onApprove && onReject && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-green-600 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950"
                          onClick={() => onApprove(order)}
                          disabled={processing === order.id}
                          title={t("fust.approve")}
                        >
                          {processing === order.id ? (
                            <RiLoader4Line className="h-4 w-4 animate-spin" />
                          ) : (
                            <RiCheckLine className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                          onClick={() => onReject(order)}
                          disabled={processing === order.id}
                          title={t("fust.reject")}
                        >
                          <RiCloseLine className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => onTimeline(order)}
                      title={t("fust.history")}
                    >
                      <RiHistoryLine className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
