"use client";

import { useState, useMemo, useCallback } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { Button } from "@/components/ui/button";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { RiLink, RiLinkUnlink } from "@remixicon/react";
import { toast } from "sonner";
import { VoucherTable } from "./voucher-table";
import { OrderTable } from "./order-table";
import { useRangeSelection } from "./use-range-selection";
import type { Voucher, OrderRef, ViewMode } from "./types";

export function VoucherMatching() {
  const { t } = useLanguage();
  const tAny = t as unknown as (key: string) => string;

  // ─── State ───────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("unmatched");
  const [supplierFilter, setSupplierFilter] = useState<string[]>([]);
  const [transporterFilter, setTransporterFilter] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [mobileTab, setMobileTab] = useState<"vouchers" | "orders">("vouchers");

  // ─── Data ────────────────────────────────────────────
  const {
    data: allVouchers,
    loading: vLoading,
    refetch: refetchVouchers,
  } = useFetch<Voucher[]>("/api/fust/vouchers");
  const {
    data: allOrders,
    loading: oLoading,
    refetch: refetchOrders,
  } = useFetch<OrderRef[]>("/api/fust/orders?status=delivered");

  // ─── Filter Options ──────────────────────────────────
  const transporterOptions = useMemo(() => {
    if (!allVouchers) return [];
    const names = new Set(
      allVouchers
        .map((v) => v.transporterName)
        .filter((n): n is string => !!n)
    );
    return Array.from(names).sort();
  }, [allVouchers]);

  const supplierOptions = useMemo(() => {
    if (!allOrders) return [];
    const codes = new Set(allOrders.map((o) => o.supplier.code));
    return Array.from(codes).sort();
  }, [allOrders]);

  // ─── Client-side Filtering ───────────────────────────
  const filteredVouchers = useMemo(() => {
    if (!allVouchers) return [];
    let result = allVouchers;

    if (viewMode === "unmatched") {
      result = result.filter((v) => v.orderLinks.length === 0);
    }

    if (transporterFilter.length > 0) {
      result = result.filter(
        (v) => v.transporterName && transporterFilter.includes(v.transporterName)
      );
    }

    if (supplierFilter.length > 0) {
      result = result.filter(
        (v) =>
          v.customerName &&
          supplierFilter.some((code) =>
            v.customerName!.toLowerCase().includes(code.toLowerCase())
          )
      );
    }

    return result;
  }, [allVouchers, viewMode, transporterFilter, supplierFilter]);

  const filteredOrders = useMemo(() => {
    if (!allOrders) return [];
    let result = allOrders;

    if (supplierFilter.length > 0) {
      result = result.filter((o) => supplierFilter.includes(o.supplier.code));
    }

    return result;
  }, [allOrders, supplierFilter]);

  // ─── Selection ───────────────────────────────────────
  const voucherSelection = useRangeSelection({
    data: filteredVouchers,
    getRowId: (v) => v.id,
  });
  const orderSelection = useRangeSelection({
    data: filteredOrders,
    getRowId: (o) => o.id,
  });

  const hasSelection =
    voucherSelection.selectedCount > 0 && orderSelection.selectedCount > 0;

  const selectedVouchersHaveLinks = useMemo(() => {
    if (!allVouchers) return false;
    return Array.from(voucherSelection.selectedIds).some((id) => {
      const v = allVouchers.find((voucher) => voucher.id === id);
      return v && v.orderLinks.length > 0;
    });
  }, [allVouchers, voucherSelection.selectedIds]);

  // ─── Handlers ────────────────────────────────────────
  const refetchBoth = useCallback(() => {
    refetchVouchers();
    refetchOrders();
  }, [refetchVouchers, refetchOrders]);

  const handleLink = useCallback(async () => {
    if (!hasSelection) return;
    setLinking(true);

    const voucherIds = Array.from(voucherSelection.selectedIds);
    const orderIds = Array.from(orderSelection.selectedIds);

    try {
      let allOk = true;
      for (const voucherId of voucherIds) {
        const res = await fetch(`/api/fust/vouchers/${voucherId}/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIds }),
        });
        if (!res.ok) {
          allOk = false;
          const err = await res.json();
          toast.error(err.error || "Failed to link");
          break;
        }
      }

      if (allOk) {
        toast.success(tAny("fust.voucherMatched"));
        voucherSelection.clearSelection();
        orderSelection.clearSelection();
        refetchBoth();
      }
    } catch {
      toast.error("Failed to link");
    } finally {
      setLinking(false);
    }
  }, [hasSelection, voucherSelection, orderSelection, tAny, refetchBoth]);

  const handleUnlink = useCallback(async () => {
    if (voucherSelection.selectedCount === 0) return;
    setUnlinking(true);

    try {
      let allOk = true;
      for (const voucherId of Array.from(voucherSelection.selectedIds)) {
        const voucher = allVouchers?.find((v) => v.id === voucherId);
        if (!voucher) continue;

        for (const link of voucher.orderLinks) {
          const res = await fetch(`/api/fust/vouchers/${voucherId}/match`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: link.orderId }),
          });
          if (!res.ok) {
            allOk = false;
            break;
          }
        }
        if (!allOk) break;
      }

      if (allOk) {
        toast.success(tAny("fust.voucherUnmatched"));
        voucherSelection.clearSelection();
        refetchBoth();
      } else {
        toast.error("Failed to unlink");
      }
    } catch {
      toast.error("Failed to unlink");
    } finally {
      setUnlinking(false);
    }
  }, [voucherSelection, allVouchers, tAny, refetchBoth]);

  return (
    <div className="flex flex-col gap-3">
      {/* ─── Toolbar ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* View mode toggle */}
        <div className="inline-flex rounded-md border">
          <button
            type="button"
            className={`px-2.5 py-1 text-xs font-medium rounded-l-md transition-colors ${
              viewMode === "unmatched"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => setViewMode("unmatched")}
          >
            {tAny("fust.viewUnmatched")}
          </button>
          <button
            type="button"
            className={`px-2.5 py-1 text-xs font-medium rounded-r-md border-l transition-colors ${
              viewMode === "all"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => setViewMode("all")}
          >
            {tAny("fust.viewAll")}
          </button>
        </div>

        {supplierOptions.length > 0 && (
          <MultiSelectFilter
            label={tAny("fust.supplierFilter")}
            options={supplierOptions}
            selected={supplierFilter}
            onChange={setSupplierFilter}
          />
        )}
        {transporterOptions.length > 0 && (
          <MultiSelectFilter
            label={tAny("fust.transporterFilter")}
            options={transporterOptions}
            selected={transporterFilter}
            onChange={setTransporterFilter}
          />
        )}
      </div>

      {/* ─── Mobile Tab Toggle (< lg) ──────────────────── */}
      <div className="flex border-b lg:hidden">
        <button
          className={`flex-1 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            mobileTab === "vouchers"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground"
          }`}
          onClick={() => setMobileTab("vouchers")}
        >
          {tAny("fust.vouchersCount")} ({filteredVouchers.length})
        </button>
        <button
          className={`flex-1 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            mobileTab === "orders"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground"
          }`}
          onClick={() => setMobileTab("orders")}
        >
          {tAny("fust.ordersCount")} ({filteredOrders.length})
        </button>
      </div>

      {/* ─── Dual Grid ──────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className={mobileTab !== "vouchers" ? "hidden lg:block" : ""}>
          <VoucherTable
            data={filteredVouchers}
            loading={vLoading}
            selection={voucherSelection}
            viewMode={viewMode}
          />
        </div>
        <div className={mobileTab !== "orders" ? "hidden lg:block" : ""}>
          <OrderTable
            data={filteredOrders}
            loading={oLoading}
            selection={orderSelection}
          />
        </div>
      </div>

      {/* ─── Action Bar ─────────────────────────────────── */}
      {(voucherSelection.selectedCount > 0 || orderSelection.selectedCount > 0) && (
        <div className="sticky bottom-0 flex items-center justify-between rounded-lg border bg-card px-3 py-2 shadow-lg">
          <p className="text-xs text-muted-foreground">
            {voucherSelection.selectedCount > 0 && (
              <span>
                {voucherSelection.selectedCount} {tAny("fust.vouchersCount").toLowerCase()}
              </span>
            )}
            {voucherSelection.selectedCount > 0 && orderSelection.selectedCount > 0 && (
              <span>, </span>
            )}
            {orderSelection.selectedCount > 0 && (
              <span>
                {orderSelection.selectedCount} {tAny("fust.ordersCount").toLowerCase()}
              </span>
            )}
            <span className="ml-1">{tAny("common.selected").toLowerCase()}</span>
          </p>
          <div className="flex items-center gap-2">
            {selectedVouchersHaveLinks && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleUnlink}
                disabled={unlinking}
              >
                <RiLinkUnlink className="mr-1 h-3.5 w-3.5" />
                {tAny("fust.unlinkSelected")}
              </Button>
            )}
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleLink}
              disabled={!hasSelection || linking}
            >
              <RiLink className="mr-1 h-3.5 w-3.5" />
              {tAny("fust.linkSelected")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
