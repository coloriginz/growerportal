"use client";

import { useState, useMemo } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatDate } from "@/lib/format";
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
import { RiFileTextLine, RiLink } from "@remixicon/react";

// ─── Types ──────────────────────────────────────────────

interface FustTypeRef {
  id: string;
  code: string;
  name: string;
}

interface OrderRef {
  id: string;
  orderNumber: string;
  status: string;
  deliveredAt: string | null;
  grower: { id: string; code: string; name: string; company: string | null };
  items: Array<{ id: string; quantity: number; fustType: FustTypeRef }>;
  voucherLinks?: Array<{
    id: string;
    voucher: { id: string; transactionNumber: string; type: string; transactionDate: string };
  }>;
}

type TabFilter = "ready" | "invoiced";

// ─── Component ──────────────────────────────────────────

export function FustInvoicing() {
  const { t } = useLanguage();
  const tAny = t as unknown as (key: string) => string;
  const [activeTab, setActiveTab] = useState<TabFilter>("ready");

  const { data: orders, loading } = useFetch<OrderRef[]>(
    "/api/fust/orders?status=delivered"
  );

  // Orders with voucher links are "matched" and ready for invoicing
  const readyOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => (o.voucherLinks?.length ?? 0) > 0);
  }, [orders]);

  const counts = useMemo(() => ({
    ready: readyOrders.length,
    invoiced: 0, // placeholder for future
  }), [readyOrders]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">
        {tAny("fust.invoicesTitle")}
      </h1>

      {/* Tab filter */}
      <div className="flex items-center gap-1 border-b">
        <button
          className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "ready"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("ready")}
        >
          {tAny("fust.readyForInvoicing")} ({counts.ready})
        </button>
        <button
          className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "invoiced"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("invoiced")}
        >
          {tAny("fust.sentInvoices")} ({counts.invoiced})
        </button>
      </div>

      {activeTab === "ready" && (
        <>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : readyOrders.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <RiFileTextLine className="mx-auto mb-2 h-10 w-10 opacity-30" />
              <p className="text-sm">{tAny("fust.noReadyOrders")}</p>
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tAny("fust.orderNumber")}</TableHead>
                    <TableHead>{tAny("fust.grower")}</TableHead>
                    <TableHead>{tAny("fust.delivered")}</TableHead>
                    <TableHead>{tAny("fust.items")}</TableHead>
                    <TableHead>{tAny("fust.linkedVouchers")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {readyOrders.map((order) => {
                    const itemsSummary = order.items
                      .map((item) => `${item.quantity}x ${item.fustType.name}`)
                      .join(", ");
                    return (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono font-medium">
                          {order.orderNumber}
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{order.grower.code}</span>
                          <span className="ml-1.5 text-muted-foreground">
                            {order.grower.company || order.grower.name}
                          </span>
                        </TableCell>
                        <TableCell>
                          {order.deliveredAt ? formatDate(order.deliveredAt) : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {itemsSummary}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            {order.voucherLinks?.map((link) => (
                              <Badge key={link.id} variant="outline" className="gap-1 mr-1">
                                <RiLink className="h-3 w-3" />
                                #{link.voucher.transactionNumber}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {activeTab === "invoiced" && (
        <div className="py-16 text-center text-muted-foreground">
          <RiFileTextLine className="mx-auto mb-2 h-10 w-10 opacity-30" />
          <p className="text-sm">{tAny("fust.noInvoices")}</p>
        </div>
      )}
    </div>
  );
}
