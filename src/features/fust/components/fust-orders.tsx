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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { RiCheckLine, RiCloseLine, RiBox3Line } from "@remixicon/react";
import { toast } from "sonner";

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
  grower: {
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
  const statusMap: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; key: string }> = {
    pending: { variant: "outline", key: "fust.pending" },
    approved: { variant: "default", key: "fust.approved" },
    rejected: { variant: "destructive", key: "fust.rejected" },
    scheduled: { variant: "secondary", key: "fust.scheduled" },
    in_transit: { variant: "secondary", key: "fust.inTransit" },
    delivered: { variant: "default", key: "fust.delivered" },
    cancelled: { variant: "destructive", key: "fust.cancelled" },
  };
  const config = statusMap[status] || { variant: "outline" as const, key: status };
  return (
    <Badge variant={config.variant}>
      {t(config.key as Parameters<typeof t>[0])}
    </Badge>
  );
}

export function FustOrders() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const growerId = searchParams.get("growerId");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [rejectDialogOrder, setRejectDialogOrder] = useState<FustOrder | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (growerId) params.set("growerId", growerId);
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    return `/api/fust/orders?${params.toString()}`;
  }, [growerId, statusFilter]);

  const { data: orders, loading, refetch } = useFetch<FustOrder[]>(url);

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("fust.title")}</h1>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("fust.filterByStatus")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              <SelectItem value="pending">{t("fust.pending")}</SelectItem>
              <SelectItem value="approved">{t("fust.approved")}</SelectItem>
              <SelectItem value="rejected">{t("fust.rejected")}</SelectItem>
              <SelectItem value="delivered">{t("fust.delivered")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-48" />
      ) : !orders || orders.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <RiBox3Line className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p>{t("fust.noOrders")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fust.orderNumber")}</TableHead>
                <TableHead>{t("fust.grower")}</TableHead>
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
                        <p className="text-sm font-medium">{order.grower.code}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.grower.company || order.grower.name}
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
                      {order.status === "pending" && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-green-600 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950"
                            onClick={() => handleApprove(order)}
                            disabled={processing === order.id}
                            title={t("fust.approve")}
                          >
                            <RiCheckLine className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                            onClick={() => {
                              setRejectDialogOrder(order);
                              setRejectionReason("");
                            }}
                            disabled={processing === order.id}
                            title={t("fust.reject")}
                          >
                            <RiCloseLine className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
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
              {rejectDialogOrder?.orderNumber} - {rejectDialogOrder?.grower.code}
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
              {t("fust.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
