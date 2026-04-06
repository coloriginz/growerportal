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
import { UploadButton } from "./upload-button";
import { useRangeSelection } from "./use-range-selection";
import type { Voucher, OrderRef, ViewMode } from "./types";

export function VoucherMatching() {
  const { t } = useLanguage();
  const tAny = t as unknown as (key: string) => string;

  // ─── State ───────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("unmatched");
  const [growerFilter, setGrowerFilter] = useState<string[]>([]);
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

  const growerOptions = useMemo(() => {
    if (!allOrders) return [];
    const codes = new Set(allOrders.map((o) => o.grower.code));
    return Array.from(codes).sort();
  }, [allOrders]);

  // ─── Client-side Filtering ───────────────────────────
  const filteredVouchers = useMemo(() => {
    if (!allVouchers) return [];
    let result = allVouchers;

    // View mode filter
    if (viewMode === "unmatched") {
      result = result.filter((v) => v.orderLinks.length === 0);
    }

    // Transporter filter
    if (transporterFilter.length > 0) {
      result = result.filter(
        (v) => v.transporterName && transporterFilter.includes(v.transporterName)
      );
    }

    // Grower filter (match on customerName containing grower code)
    if (growerFilter.length > 0) {
      result = result.filter(
        (v) =>
          v.customerName &&
          growerFilter.some((code) =>
            v.customerName!.toLowerCase().includes(code.toLowerCase())
          )
      );
    }

    return result;
  }, [allVouchers, viewMode, transporterFilter, growerFilter]);

  const filteredOrders = useMemo(() => {
    if (!allOrders) return [];
    let result = allOrders;

    if (growerFilter.length > 0) {
      result = result.filter((o) => growerFilter.includes(o.grower.code));
    }

    return result;
  }, [allOrders, growerFilter]);

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

  // Check if any selected vouchers have links (for unlink)
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
  }, [
    hasSelection,
    voucherSelection,
    orderSelection,
    tAny,
    refetchBoth,
  ]);

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
    <div className="flex flex-col gap-4">
      {/* ─── Toolbar ────────────────────────────────────── */}
      <div className="relative flex flex-wrap items-center gap-2">
        {/* View mode toggle */}
        <div className="inline-flex rounded-md border">
          <button
            type="button"
            className={`px-3 py-1.5 text-sm font-medium rounded-l-md transition-colors ${
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
            className={`px-3 py-1.5 text-sm font-medium rounded-r-md border-l transition-colors ${
              viewMode === "all"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => setViewMode("all")}
          >
            {tAny("fust.viewAll")}
          </button>
        </div>

        {/* Filters */}
        {growerOptions.length > 0 && (
          <MultiSelectFilter
            label={tAny("fust.growerFilter")}
            options={growerOptions}
            selected={growerFilter}
            onChange={setGrowerFilter}
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

        {/* Upload button - pushed right */}
        <div className="ml-auto">
          <UploadButton onUploaded={refetchBoth} />
        </div>
      </div>

      {/* ─── Mobile Tab Toggle (< lg) ──────────────────── */}
      <div className="flex border-b lg:hidden">
        <button
          className={`flex-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            mobileTab === "vouchers"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground"
          }`}
          onClick={() => setMobileTab("vouchers")}
        >
          {tAny("fust.vouchersCount")} ({filteredVouchers.length})
        </button>
        <button
          className={`flex-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
        <div className="sticky bottom-0 flex items-center justify-between rounded-lg border bg-card px-4 py-3 shadow-lg">
          <p className="text-sm text-muted-foreground">
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
            {/* Unlink button: only when vouchers with links are selected */}
            {selectedVouchersHaveLinks && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnlink}
                disabled={unlinking}
              >
                <RiLinkUnlink className="mr-1.5 h-4 w-4" />
                {tAny("fust.unlinkSelected")}
              </Button>
            )}
            {/* Link button: needs both sides selected */}
            <Button
              size="sm"
              onClick={handleLink}
              disabled={!hasSelection || linking}
            >
              <RiLink className="mr-1.5 h-4 w-4" />
              {tAny("fust.linkSelected")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
