"use client";

import { useState, useMemo, useCallback } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatCurrencyDetailed, formatDate, formatNumber } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RiAddLine,
  RiSubtractLine,
  RiShoppingCartLine,
  RiDeleteBinLine,
  RiBox3Line,
} from "@remixicon/react";
import { toast } from "sonner";

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

interface CartItem {
  fustType: FustType;
  quantity: number;
}

interface FustWebshopProps {
  growerId: string | null;
}

const CATEGORY_ORDER = ["emmers", "opzetrekken", "karren", "kratten", "dozen", "overig"];

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

export function FustWebshop({ growerId }: FustWebshopProps) {
  const { t } = useLanguage();
  const [cart, setCart] = useState<Map<string, CartItem>>(new Map());
  const [requestedDate, setRequestedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<string | number>("order");

  const { data: fustTypes, loading: typesLoading } = useFetch<FustType[]>("/api/fust/types");

  const ordersUrl = useMemo(() => {
    if (growerId) return `/api/fust/orders?growerId=${growerId}`;
    return "/api/fust/orders";
  }, [growerId]);

  const { data: orders, loading: ordersLoading, refetch: refetchOrders } = useFetch<FustOrder[]>(ordersUrl);

  // Group fust types by category
  const groupedTypes = useMemo(() => {
    if (!fustTypes) return new Map<string, FustType[]>();
    const map = new Map<string, FustType[]>();
    for (const cat of CATEGORY_ORDER) {
      const items = fustTypes.filter((ft) => ft.category === cat);
      if (items.length > 0) map.set(cat, items);
    }
    return map;
  }, [fustTypes]);

  const cartTotal = useMemo(() => {
    let total = 0;
    for (const item of cart.values()) {
      total += Number(item.fustType.pricePerUnit) * item.quantity;
    }
    return total;
  }, [cart]);

  const cartItemCount = useMemo(() => {
    let count = 0;
    for (const item of cart.values()) {
      count += item.quantity;
    }
    return count;
  }, [cart]);

  const updateCart = useCallback((fustType: FustType, delta: number) => {
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(fustType.id);
      const newQty = (existing?.quantity || 0) + delta;
      if (newQty <= 0) {
        next.delete(fustType.id);
      } else {
        next.set(fustType.id, { fustType, quantity: newQty });
      }
      return next;
    });
  }, []);

  const setCartQuantity = useCallback((fustType: FustType, quantity: number) => {
    setCart((prev) => {
      const next = new Map(prev);
      if (quantity <= 0) {
        next.delete(fustType.id);
      } else {
        next.set(fustType.id, { fustType, quantity });
      }
      return next;
    });
  }, []);

  const handleSubmitOrder = async () => {
    if (cart.size === 0) return;
    setSubmitting(true);
    try {
      const items = Array.from(cart.values()).map((item) => ({
        fustTypeId: item.fustType.id,
        quantity: item.quantity,
      }));

      const res = await fetch("/api/fust/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          growerId: growerId || undefined,
          requestedDate: requestedDate || null,
          notes: notes || null,
          items,
        }),
      });

      if (res.ok) {
        toast.success(t("fust.orderPlaced"));
        setCart(new Map());
        setRequestedDate("");
        setNotes("");
        refetchOrders();
        setActiveTab("myorders");
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to place order");
      }
    } catch {
      toast.error("Failed to place order");
    } finally {
      setSubmitting(false);
    }
  };

  const deliveredOrders = useMemo(
    () => orders?.filter((o) => o.status === "delivered") || [],
    [orders]
  );

  const categoryLabel = (cat: string) => {
    const key = `fust.${cat}` as Parameters<typeof t>[0];
    return t(key);
  };

  if (typesLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("fust.title")}</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="order">{t("fust.tabOrder")}</TabsTrigger>
          <TabsTrigger value="myorders">
            {t("fust.tabMyOrders")}
            {orders && orders.length > 0 && (
              <span className="ml-1.5 text-xs opacity-60">({orders.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="deliveries">{t("fust.tabDeliveries")}</TabsTrigger>
        </TabsList>

        {/* ─── TAB: Order (Webshop) ─── */}
        <TabsContent value="order">
          <div className="mt-4 space-y-8">
            {Array.from(groupedTypes.entries()).map(([category, types]) => (
              <div key={category}>
                <h2 className="mb-3 text-lg font-semibold">{categoryLabel(category)}</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {types.map((ft) => {
                    const cartItem = cart.get(ft.id);
                    const qty = cartItem?.quantity || 0;
                    return (
                      <Card key={ft.id} className="flex flex-col gap-3 p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <RiBox3Line className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-tight">{ft.name}</p>
                            <p className="text-xs text-muted-foreground">{ft.code}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">
                            {formatCurrencyDetailed(Number(ft.pricePerUnit))}
                            <span className="text-xs font-normal text-muted-foreground"> {t("fust.perUnit")}</span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateCart(ft, -1)}
                              disabled={qty === 0}
                            >
                              <RiSubtractLine className="h-3.5 w-3.5" />
                            </Button>
                            <Input
                              type="number"
                              min={0}
                              value={qty || ""}
                              placeholder="0"
                              onChange={(e) => setCartQuantity(ft, parseInt(e.target.value) || 0)}
                              className="h-7 w-14 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateCart(ft, 1)}
                            >
                              <RiAddLine className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Cart Summary / Checkout */}
            {cart.size > 0 && (
              <div className="sticky bottom-4 z-10">
                <Card className="border-primary/20 bg-card p-4 shadow-lg">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <RiShoppingCartLine className="h-5 w-5 text-primary" />
                      <div>
                        <p className="text-sm font-medium">
                          {t("fust.cart")}: {cartItemCount} {t("fust.items")}
                        </p>
                        <p className="text-lg font-bold">{formatCurrencyDetailed(cartTotal)}</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <Input
                        type="date"
                        value={requestedDate}
                        onChange={(e) => setRequestedDate(e.target.value)}
                        className="h-9 w-auto text-sm"
                        placeholder={t("fust.selectDate")}
                        min={new Date().toISOString().split("T")[0]}
                      />
                      <Input
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={t("fust.orderNotes")}
                        className="h-9 w-auto text-sm"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCart(new Map())}
                        >
                          {t("fust.clearCart")}
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSubmitOrder}
                          disabled={submitting}
                        >
                          {submitting ? t("common.loading") : t("fust.checkout")}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Cart item details */}
                  <div className="mt-3 border-t pt-3">
                    <div className="flex flex-wrap gap-2">
                      {Array.from(cart.values()).map((item) => (
                        <span
                          key={item.fustType.id}
                          className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs"
                        >
                          {item.quantity}x {item.fustType.name}
                          <span className="text-muted-foreground">
                            {formatCurrencyDetailed(Number(item.fustType.pricePerUnit) * item.quantity)}
                          </span>
                          <button
                            onClick={() => setCart((prev) => { const next = new Map(prev); next.delete(item.fustType.id); return next; })}
                            className="ml-0.5 text-muted-foreground hover:text-destructive"
                          >
                            <RiDeleteBinLine className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </Card>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ─── TAB: My Orders ─── */}
        <TabsContent value="myorders">
          <div className="mt-4">
            {ordersLoading ? (
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
        </TabsContent>

        {/* ─── TAB: Deliveries ─── */}
        <TabsContent value="deliveries">
          <div className="mt-4">
            {ordersLoading ? (
              <Skeleton className="h-48" />
            ) : deliveredOrders.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <RiBox3Line className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p>{t("fust.noDeliveries")}</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
