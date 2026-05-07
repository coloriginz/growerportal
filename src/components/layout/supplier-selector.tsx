"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { RiPlantLine, RiSearchLine, RiArrowUpDownLine, RiCheckLine } from "@remixicon/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/providers/language-provider";
import { Suspense } from "react";

interface SupplierOption {
  id: string;
  code: string;
  name: string;
  company: string | null;
  companyEntity?: { id: string; name: string; slug: string } | null;
}

function SupplierSelectorInner() {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  // Read supplierId only from URL (no persistence between sessions)
  const selectedSupplierId = searchParams.get("supplierId") || "";

  useEffect(() => {
    async function fetchSuppliers() {
      try {
        const res = await fetch("/api/suppliers");
        if (res.ok) {
          const data = await res.json();
          setSuppliers(data);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchSuppliers();
  }, []);

  const selectedSupplier = suppliers.find((g) => g.id === selectedSupplierId);

  const filtered = useMemo(() => {
    if (!search) return suppliers;
    const q = search.toLowerCase();
    return suppliers.filter(
      (g) =>
        g.code.toLowerCase().includes(q) ||
        g.name.toLowerCase().includes(q) ||
        (g.company && g.company.toLowerCase().includes(q))
    );
  }, [suppliers, search]);

  const handleSelect = useCallback((supplierId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (supplierId === selectedSupplierId) {
      params.delete("supplierId");
    } else {
      params.set("supplierId", supplierId);
    }
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
    setSearch("");
  }, [searchParams, selectedSupplierId, router, pathname]);

  if (loading) {
    return <div className="bg-muted h-10 animate-pulse rounded-md" />;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between text-left font-normal"
          />
        }
      >
          <div className="flex items-center gap-2 truncate">
            <RiPlantLine className="text-muted-foreground h-4 w-4 shrink-0" />
            {selectedSupplier ? (
              <span className="truncate">
                <span className="font-medium">{selectedSupplier.code}</span>
                <span className="text-sidebar-foreground/60 ml-2 text-xs">
                  {selectedSupplier.company || selectedSupplier.name}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                {t("common.search")}
              </span>
            )}
          </div>
          <RiArrowUpDownLine className="text-muted-foreground h-4 w-4 shrink-0" />
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <RiSearchLine className="text-muted-foreground h-4 w-4 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search supplier..."
              className="placeholder:text-muted-foreground w-full bg-transparent text-sm outline-none"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              No suppliers found
            </p>
          ) : (
            filtered.map((supplier) => (
              <button
                key={supplier.id}
                type="button"
                onClick={() => handleSelect(supplier.id)}
                className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors"
              >
                <RiCheckLine
                  className={`h-4 w-4 shrink-0 ${
                    supplier.id === selectedSupplierId
                      ? "opacity-100"
                      : "opacity-0"
                  }`}
                />
                <span className="font-medium">{supplier.code}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {supplier.company || supplier.name}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SupplierSelector() {
  return (
    <Suspense
      fallback={<div className="bg-muted h-10 animate-pulse rounded-md" />}
    >
      <SupplierSelectorInner />
    </Suspense>
  );
}
