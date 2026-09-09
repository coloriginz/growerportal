"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  // Het item waar de pijltjestoetsen op staan. Wordt op 0 gezet zodra de lijst
  // van vorm verandert (zoeken, openen), nooit vanuit een effect: React 19
  // verbiedt setState in een effect-body, en elk moment waarop de lijst verandert
  // is een event dat we al in handen hebben.
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
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

  // De lijst kan korter worden terwijl activeIndex nog op een oude positie staat
  // (typen filtert weg). Daarom hier klemmen in plaats van de state te corrigeren.
  const activeIdx = filtered.length > 0 ? Math.min(activeIndex, filtered.length - 1) : -1;

  // Meelopen met de selectie: zonder dit verdwijnt het gemarkeerde item bij de
  // tiende pijltjesdruk onder de rand van de lijst.
  useEffect(() => {
    if (!open || activeIdx < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIdx]);

  const handleSelect = useCallback((supplierId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (supplierId === selectedSupplierId) {
      params.delete("supplierId");
    } else {
      params.set("supplierId", supplierId);
    }

    // Always navigate to dashboard when selecting a (different) supplier
    router.push(`/dashboard?${params.toString()}`);
    setOpen(false);
    setSearch("");
    setActiveIndex(0);
  }, [searchParams, selectedSupplierId, router]);

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // preventDefault, anders springt de cursor in het zoekveld naar begin of eind.
      e.preventDefault();
      if (filtered.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => {
        const from = Math.min(i, filtered.length - 1);
        return Math.min(Math.max(from + step, 0), filtered.length - 1);
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const supplier = filtered[activeIdx];
      if (supplier) handleSelect(supplier.id);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActiveIndex(e.key === "Home" ? 0 : Math.max(filtered.length - 1, 0));
    }
  }

  if (loading) {
    return <div className="bg-muted h-10 animate-pulse rounded-md" />;
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Elke keer bovenaan beginnen; een onthouden positie hoort bij een lijst
        // die niet meebeweegt met het zoekveld.
        setActiveIndex(0);
        if (!next) setSearch("");
      }}
    >
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
              onChange={(e) => {
                setSearch(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search supplier..."
              className="placeholder:text-muted-foreground w-full bg-transparent text-sm outline-none"
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls="supplier-selector-list"
              aria-activedescendant={
                activeIdx >= 0 ? `supplier-option-${filtered[activeIdx].id}` : undefined
              }
            />
          </div>
        </div>
        <div
          ref={listRef}
          id="supplier-selector-list"
          role="listbox"
          className="max-h-60 overflow-y-auto p-1"
        >
          {filtered.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              No suppliers found
            </p>
          ) : (
            filtered.map((supplier, index) => (
              <button
                key={supplier.id}
                id={`supplier-option-${supplier.id}`}
                type="button"
                role="option"
                aria-selected={supplier.id === selectedSupplierId}
                data-active={index === activeIdx}
                // De muis neemt de markering over, zodat er nooit twee tegelijk
                // oplichten wanneer je na het typen weer gaat wijzen.
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => handleSelect(supplier.id)}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors ${
                  index === activeIdx ? "bg-accent text-accent-foreground" : ""
                }`}
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
