"use client";

import { useState, useMemo, useCallback } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatCurrencyDetailed } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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

interface CartItem {
  fustType: FustType;
  quantity: number;
}

interface FustWebshopProps {
  growerId: string | null;
  userRole?: string;
}

const CATEGORY_ORDER = ["emmers", "opzetrekken", "karren", "kratten", "dozen", "overig"];

export function FustWebshop({ growerId, userRole }: FustWebshopProps) {
  const { t } = useLanguage();
  const canOrder = userRole === "grower";
  const [cart, setCart] = useState<Map<string, CartItem>>(new Map());
  const [requestedDate, setRequestedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: fustTypes, loading: typesLoading } = useFetch<FustType[]>("/api/fust/types");

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
        const data = await res.json();
        if (data.previewUrl) {
          toast.success(t("fust.orderPlaced"), {
            description: "Ethereal preview available",
            action: {
              label: "Open",
              onClick: () => window.open(data.previewUrl, "_blank"),
            },
            duration: 15000,
          });
        } else {
          toast.success(t("fust.orderPlaced"));
        }
        setCart(new Map());
        setRequestedDate("");
        setNotes("");
        // Order placed successfully
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
        <h1 className="text-2xl font-bold tracking-tight">{canOrder ? t("fust.title") : t("fust.catalogue")}</h1>
      </div>

      <div className="space-y-6">
            {Array.from(groupedTypes.entries()).map(([category, types], catIndex) => (
              <div key={category}>
                {catIndex > 0 && <Separator className="mb-6" />}
                <h2 className="mb-3 text-lg font-semibold">{categoryLabel(category)}</h2>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("fust.code")}</TableHead>
                        <TableHead>{t("fust.name")}</TableHead>
                        <TableHead className="text-right">{t("fust.price")}</TableHead>
                        {canOrder && <TableHead className="text-center w-40">{t("fust.quantity")}</TableHead>}
                        {canOrder && <TableHead className="text-right">{t("fust.subtotal")}</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {types.map((ft) => {
                        const cartItem = cart.get(ft.id);
                        const qty = cartItem?.quantity || 0;
                        const subtotal = Number(ft.pricePerUnit) * qty;
                        return (
                          <TableRow key={ft.id} className={qty > 0 ? "bg-primary/5" : ""}>
                            <TableCell className="font-mono text-sm">{ft.code}</TableCell>
                            <TableCell className="font-medium">{ft.name}</TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              {formatCurrencyDetailed(Number(ft.pricePerUnit))}
                            </TableCell>
                            {canOrder && (
                              <TableCell>
                                <div className="flex items-center justify-center gap-1.5">
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
                              </TableCell>
                            )}
                            {canOrder && (
                              <TableCell className="text-right font-medium whitespace-nowrap">
                                {qty > 0 ? formatCurrencyDetailed(subtotal) : "-"}
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}

            {/* Cart Summary / Checkout */}
            {canOrder && cart.size > 0 && (
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
                          {item.quantity}x {item.fustType.code} — {item.fustType.name}
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
    </div>
  );
}
