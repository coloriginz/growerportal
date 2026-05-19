"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { getISOWeek, getISOWeekYear } from "date-fns";
import { SelectSupplierPrompt } from "@/components/ui/select-supplier-prompt";
import { useFetch } from "@/hooks/use-fetch";
import { useLanguage } from "@/components/providers/language-provider";
import { ErrorState } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCalendarLine,
  RiAddLine,
  RiFileCopyLine,
  RiDownloadLine,
  RiDeleteBinLine,
  RiLoader4Line,
  RiCheckLine,
  RiCloseLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { CopyWeekDialog } from "./copy-week-dialog";
import { ForecastYearChart } from "./forecast-year-chart";

const VISIBLE_WEEKS = 6;

interface Forecast {
  id: string;
  supplierId: string;
  productName: string;
  articleGroup: string | null;
  year: number;
  week: number;
  stems: number;
  trolleys: number | null;
  colli: number | null;
}

interface Product {
  name: string;
  articleGroup: string | null;
}

interface ForecastsData {
  forecasts: Forecast[];
  products: Product[];
}

interface WeekKey {
  year: number;
  week: number;
}

type CellStatus = "idle" | "saving" | "saved" | "error";

export function ForecastsContent({ supplierId }: { supplierId: string | null }) {
  if (!supplierId) return <SelectSupplierPrompt />;
  const { t } = useLanguage();
  const now = new Date();
  const currentISOWeek = getISOWeek(now);
  const currentISOYear = getISOWeekYear(now);

  const [startYear, setStartYear] = useState(currentISOYear);
  const [startWeek, setStartWeek] = useState(currentISOWeek);
  const [activeProducts, setActiveProducts] = useState<Product[]>([]);
  const [cellStatuses, setCellStatuses] = useState<Record<string, CellStatus>>({});
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [productInput, setProductInput] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const productInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Generate visible weeks
  const visibleWeeks = useMemo(() => {
    const weeks: WeekKey[] = [];
    let y = startYear;
    let w = startWeek;
    for (let i = 0; i < VISIBLE_WEEKS; i++) {
      weeks.push({ year: y, week: w });
      w++;
      const maxWeek = getISOWeeksInYear(y);
      if (w > maxWeek) {
        w = 1;
        y++;
      }
    }
    return weeks;
  }, [startYear, startWeek]);

  const lastWeek = visibleWeeks[visibleWeeks.length - 1];

  // Build fetch URL
  const url = useMemo(() => {
    if (!supplierId) return null;
    const params = new URLSearchParams({
      supplierId,
      yearFrom: String(startYear),
      weekFrom: String(startWeek),
      yearTo: String(lastWeek.year),
      weekTo: String(lastWeek.week),
    });
    return `/api/forecasts?${params}`;
  }, [supplierId, startYear, startWeek, lastWeek]);

  const { data, loading, error, refetch } = useFetch<ForecastsData>(url);

  // Fetch full year data for the chart
  const yearUrl = useMemo(() => {
    if (!supplierId) return null;
    const params = new URLSearchParams({
      supplierId,
      yearFrom: String(currentISOYear),
      weekFrom: "1",
      yearTo: String(currentISOYear),
      weekTo: "52",
    });
    return `/api/forecasts?${params}`;
  }, [supplierId, currentISOYear]);

  const { data: yearData, refetch: refetchYear } = useFetch<ForecastsData>(yearUrl);

  // Sync active products from fetched data
  useEffect(() => {
    if (data?.forecasts && data.forecasts.length > 0) {
      const productNames = new Set(activeProducts.map((p) => p.name));
      const newProducts: Product[] = [];
      for (const f of data.forecasts) {
        if (!productNames.has(f.productName)) {
          productNames.add(f.productName);
          newProducts.push({
            name: f.productName,
            articleGroup: f.articleGroup,
          });
        }
      }
      if (newProducts.length > 0) {
        setActiveProducts((prev) => {
          const existingNames = new Set(prev.map((p) => p.name));
          const toAdd = newProducts.filter((p) => !existingNames.has(p.name));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.forecasts]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          productInputRef.current && !productInputRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const getCellValue = useCallback(
    (productName: string, year: number, week: number, field: "stems" | "trolleys" | "colli"): number => {
      if (!data?.forecasts) return 0;
      const forecast = data.forecasts.find(
        (f) => f.productName === productName && f.year === year && f.week === week
      );
      if (!forecast) return 0;
      return (forecast[field] as number) ?? 0;
    },
    [data?.forecasts]
  );

  const isWeekPast = useCallback(
    (year: number, week: number) => {
      return year < currentISOYear || (year === currentISOYear && week < currentISOWeek);
    },
    [currentISOYear, currentISOWeek]
  );

  const isCurrentWeek = useCallback(
    (year: number, week: number) => {
      return year === currentISOYear && week === currentISOWeek;
    },
    [currentISOYear, currentISOWeek]
  );

  const saveForecast = useCallback(
    async (
      productName: string,
      articleGroup: string | null,
      year: number,
      week: number,
      stems: number,
      trolleys: number | null,
      colli: number | null
    ) => {
      if (!supplierId) return;
      const cellKey = `${productName}-${year}-${week}`;
      setCellStatuses((prev) => ({ ...prev, [cellKey]: "saving" }));

      try {
        const res = await fetch("/api/forecasts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId,
            forecasts: [{ productName, articleGroup, year, week, stems, trolleys, colli }],
          }),
        });
        if (!res.ok) throw new Error("Save failed");
        setCellStatuses((prev) => ({ ...prev, [cellKey]: "saved" }));
        // Clear saved status after 2s
        setTimeout(() => {
          setCellStatuses((prev) => ({ ...prev, [cellKey]: "idle" }));
        }, 2000);
        refetch();
        refetchYear();
      } catch {
        setCellStatuses((prev) => ({ ...prev, [cellKey]: "error" }));
        toast.error(t("forecasts.saveError"));
        setTimeout(() => {
          setCellStatuses((prev) => ({ ...prev, [cellKey]: "idle" }));
        }, 3000);
      }
    },
    [supplierId, refetch, refetchYear, t]
  );

  const handleCellBlur = useCallback(
    (
      productName: string,
      articleGroup: string | null,
      year: number,
      week: number,
      field: "stems" | "trolleys" | "colli",
      newValue: string
    ) => {
      const numValue = parseInt(newValue) || 0;
      const oldValue = getCellValue(productName, year, week, field);
      if (numValue === oldValue) return;

      const currentStems = field === "stems" ? numValue : getCellValue(productName, year, week, "stems");
      const currentTrolleys = field === "trolleys" ? numValue : getCellValue(productName, year, week, "trolleys");
      const currentColli = field === "colli" ? numValue : getCellValue(productName, year, week, "colli");

      saveForecast(productName, articleGroup, year, week, currentStems, currentTrolleys || null, currentColli || null);
    },
    [getCellValue, saveForecast]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, productIdx: number, weekIdx: number) => {
      if (e.key === "Enter" || e.key === "Tab") {
        (e.target as HTMLInputElement).blur();
        if (e.key === "Enter") {
          e.preventDefault();
          // Move to next cell (next week or next product)
          const nextWeekIdx = weekIdx + 1;
          if (nextWeekIdx < VISIBLE_WEEKS) {
            const nextWeek = visibleWeeks[nextWeekIdx];
            if (!isWeekPast(nextWeek.year, nextWeek.week)) {
              const nextKey = `${productIdx}-${nextWeekIdx}`;
              inputRefs.current[nextKey]?.focus();
            }
          }
        }
      }
    },
    [visibleWeeks, isWeekPast]
  );

  const navigateWeeks = useCallback(
    (direction: number) => {
      let newWeek = startWeek + direction;
      let newYear = startYear;
      if (newWeek < 1) {
        newYear--;
        newWeek = getISOWeeksInYear(newYear);
      } else {
        const maxWeek = getISOWeeksInYear(newYear);
        if (newWeek > maxWeek) {
          newYear++;
          newWeek = 1;
        }
      }
      setStartWeek(newWeek);
      setStartYear(newYear);
    },
    [startWeek, startYear]
  );

  const navigateToWeek = useCallback(
    (week: number) => {
      setStartYear(currentISOYear);
      setStartWeek(week);
    },
    [currentISOYear]
  );

  const jumpToCurrentWeek = useCallback(() => {
    setStartYear(currentISOYear);
    setStartWeek(currentISOWeek);
  }, [currentISOYear, currentISOWeek]);

  const addProduct = useCallback(
    (product: Product) => {
      if (activeProducts.some((p) => p.name === product.name)) return;
      setActiveProducts((prev) => [...prev, product]);
      setProductInput("");
      setShowProductDropdown(false);
    },
    [activeProducts]
  );

  const addCustomProduct = useCallback(() => {
    const name = productInput.trim();
    if (!name) return;
    if (activeProducts.some((p) => p.name === name)) return;
    setActiveProducts((prev) => [...prev, { name, articleGroup: null }]);
    setProductInput("");
    setShowProductDropdown(false);
  }, [productInput, activeProducts]);

  const removeProduct = useCallback(
    async (productName: string) => {
      if (!supplierId) return;
      if (!confirm(t("forecasts.removeProductConfirm"))) return;

      try {
        await fetch("/api/forecasts", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supplierId, productName }),
        });
      } catch {
        // Ignore errors on delete
      }

      setActiveProducts((prev) => prev.filter((p) => p.name !== productName));
      refetch();
      refetchYear();
    },
    [supplierId, t, refetch, refetchYear]
  );

  const exportCSV = useCallback(() => {
    if (!data?.forecasts || activeProducts.length === 0) return;

    const headers = ["Product", "Article Group", ...visibleWeeks.map((w) => `W${w.week} ${w.year}`)];
    const rows = activeProducts.map((product) => [
      product.name,
      product.articleGroup || "",
      ...visibleWeeks.map((w) => {
        const val = getCellValue(product.name, w.year, w.week, "stems");
        return val > 0 ? String(val) : "";
      }),
    ]);

    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `forecasts-${startYear}-W${startWeek}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data?.forecasts, activeProducts, visibleWeeks, getCellValue, startYear, startWeek]);

  // Available products for autocomplete (not yet active)
  const availableProducts = useMemo(() => {
    if (!data?.products) return [];
    const activeNames = new Set(activeProducts.map((p) => p.name));
    return data.products.filter((p) => !activeNames.has(p.name));
  }, [data?.products, activeProducts]);

  const filteredProducts = useMemo(() => {
    if (!productInput.trim()) return availableProducts;
    const lower = productInput.toLowerCase();
    return availableProducts.filter((p) => p.name.toLowerCase().includes(lower));
  }, [availableProducts, productInput]);

  // Weeks that have data (for copy dialog)
  const weeksWithData = useMemo(() => {
    if (!data?.forecasts) return [];
    const weekSet = new Set<string>();
    for (const f of data.forecasts) {
      weekSet.add(`${f.year}-${f.week}`);
    }
    return Array.from(weekSet).map((key) => {
      const [y, w] = key.split("-").map(Number);
      return { year: y, week: w };
    });
  }, [data?.forecasts]);

  if (error) {
    return (
      <div className="page-content">
        <ErrorState onRetry={refetch} />
      </div>
    );
  }

  const weekRangeLabel = `${t("forecasts.week")} ${visibleWeeks[0].week}–${lastWeek.week}, ${
    visibleWeeks[0].year === lastWeek.year ? lastWeek.year : `${visibleWeeks[0].year}/${lastWeek.year}`
  }`;

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("forecasts.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("forecasts.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowCopyDialog(true)} disabled={weeksWithData.length === 0}>
            <RiFileCopyLine className="mr-1.5 h-4 w-4" />
            {t("forecasts.copyWeek")}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={activeProducts.length === 0}>
            <RiDownloadLine className="mr-1.5 h-4 w-4" />
            {t("forecasts.exportCSV")}
          </Button>
        </div>
      </div>

      {/* Year Chart */}
      {yearData && yearData.forecasts.length > 0 && (
        <ForecastYearChart
          forecasts={yearData.forecasts}
          year={currentISOYear}
          currentWeek={currentISOWeek}
          visibleStartWeek={startWeek}
          onWeekClick={navigateToWeek}
        />
      )}

      {/* Week Navigator */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border p-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateWeeks(-1)}>
            <RiArrowLeftSLine className="h-4 w-4" />
          </Button>
          <span className="min-w-[180px] text-center text-sm font-medium">{weekRangeLabel}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateWeeks(1)}>
            <RiArrowRightSLine className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={jumpToCurrentWeek}>
          <RiCalendarLine className="mr-1.5 h-4 w-4" />
          {t("forecasts.jumpToCurrentWeek")}
        </Button>
      </div>

      {/* Grid */}
      <div className="mt-6 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[700px] border-collapse">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider min-w-[200px]">
                {t("forecasts.product")}
              </th>
              {visibleWeeks.map((w) => {
                const isCurrent = isCurrentWeek(w.year, w.week);
                const isPast = isWeekPast(w.year, w.week);
                return (
                  <th
                    key={`${w.year}-${w.week}`}
                    className={`px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider min-w-[100px] ${
                      isCurrent ? "bg-primary/10 text-primary" : isPast ? "text-muted-foreground/50" : ""
                    }`}
                  >
                    <div>W{w.week}</div>
                    {w.year !== visibleWeeks[0].year && (
                      <div className="text-[10px] font-normal">{w.year}</div>
                    )}
                    {isCurrent && (
                      <div className="text-[10px] font-normal">{t("forecasts.currentWeek")}</div>
                    )}
                  </th>
                );
              })}
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider min-w-[80px]">
                {t("forecasts.total")}
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {activeProducts.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={VISIBLE_WEEKS + 3}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  {t("forecasts.noProducts")}
                </td>
              </tr>
            )}
            {activeProducts.map((product, productIdx) => {
              const rowTotal = visibleWeeks.reduce(
                (sum, w) => sum + getCellValue(product.name, w.year, w.week, "stems"),
                0
              );

              return (
                <tr key={product.name} className="border-b hover:bg-muted/30">
                  <td className="sticky left-0 z-10 bg-background px-4 py-2">
                    <div className="font-medium text-sm">{product.name}</div>
                    {product.articleGroup && (
                      <div className="text-xs text-muted-foreground">{product.articleGroup}</div>
                    )}
                  </td>
                  {visibleWeeks.map((w, weekIdx) => {
                    const isPast = isWeekPast(w.year, w.week);
                    const isCurrent = isCurrentWeek(w.year, w.week);
                    const cellKey = `${product.name}-${w.year}-${w.week}`;
                    const status = cellStatuses[cellKey] || "idle";
                    const value = getCellValue(product.name, w.year, w.week, "stems");

                    return (
                      <td
                        key={`${w.year}-${w.week}`}
                        className={`px-1 py-1 text-center ${
                          isCurrent ? "bg-primary/5" : isPast ? "bg-muted/30" : ""
                        }`}
                      >
                        <div className="relative">
                          {isPast ? (
                            <span className="text-sm text-muted-foreground/50">
                              {value > 0 ? formatNumber(value) : ""}
                            </span>
                          ) : (
                            <input
                              ref={(el) => { inputRefs.current[`${productIdx}-${weekIdx}`] = el; }}
                              type="number"
                              min="0"
                              defaultValue={value > 0 ? value : ""}
                              placeholder="—"
                              className="w-full rounded border-transparent bg-transparent px-2 py-1.5 text-center text-sm transition-colors focus:border-primary focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary hover:bg-muted/50"
                              onBlur={(e) =>
                                handleCellBlur(product.name, product.articleGroup, w.year, w.week, "stems", e.target.value)
                              }
                              onKeyDown={(e) => handleKeyDown(e, productIdx, weekIdx)}
                            />
                          )}
                          {/* Save status indicator */}
                          {status === "saving" && (
                            <RiLoader4Line className="absolute right-0.5 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin text-muted-foreground" />
                          )}
                          {status === "saved" && (
                            <RiCheckLine className="absolute right-0.5 top-1/2 h-3 w-3 -translate-y-1/2 text-green-500" />
                          )}
                          {status === "error" && (
                            <RiCloseLine className="absolute right-0.5 top-1/2 h-3 w-3 -translate-y-1/2 text-destructive" />
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center text-sm font-semibold">
                    {rowTotal > 0 ? formatNumber(rowTotal) : ""}
                  </td>
                  <td className="px-1 py-2">
                    <button
                      onClick={() => removeProduct(product.name)}
                      className="rounded p-1 text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                      title={t("forecasts.removeProduct")}
                    >
                      <RiDeleteBinLine className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}

            {/* Totals row */}
            {activeProducts.length > 0 && (
              <tr className="bg-muted/50 font-semibold">
                <td className="sticky left-0 z-10 bg-muted/50 px-4 py-2.5 text-sm">
                  {t("forecasts.total")}
                </td>
                {visibleWeeks.map((w) => {
                  const isCurrent = isCurrentWeek(w.year, w.week);
                  const colTotal = activeProducts.reduce(
                    (sum, product) => sum + getCellValue(product.name, w.year, w.week, "stems"),
                    0
                  );
                  return (
                    <td
                      key={`total-${w.year}-${w.week}`}
                      className={`px-3 py-2.5 text-center text-sm ${isCurrent ? "bg-primary/10" : ""}`}
                    >
                      {colTotal > 0 ? formatNumber(colTotal) : ""}
                    </td>
                  );
                })}
                <td className="px-3 py-2.5 text-center text-sm">
                  {(() => {
                    const grandTotal = visibleWeeks.reduce(
                      (sum, w) =>
                        sum + activeProducts.reduce(
                          (s, p) => s + getCellValue(p.name, w.year, w.week, "stems"),
                          0
                        ),
                      0
                    );
                    return grandTotal > 0 ? formatNumber(grandTotal) : "";
                  })()}
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Product */}
      <div className="relative mt-4 max-w-md">
        <div className="flex items-center gap-2">
          <RiAddLine className="h-4 w-4 text-muted-foreground" />
          <div className="relative flex-1">
            <input
              ref={productInputRef}
              type="text"
              value={productInput}
              onChange={(e) => {
                setProductInput(e.target.value);
                setShowProductDropdown(true);
              }}
              onFocus={() => setShowProductDropdown(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filteredProducts.length > 0) {
                    addProduct(filteredProducts[0]);
                  } else if (productInput.trim()) {
                    addCustomProduct();
                  }
                }
              }}
              placeholder={t("forecasts.selectProduct")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {showProductDropdown && (filteredProducts.length > 0 || productInput.trim()) && (
              <div
                ref={dropdownRef}
                className="absolute left-0 top-full z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md"
              >
                {filteredProducts.map((p) => (
                  <button
                    key={p.name}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => addProduct(p)}
                  >
                    <div>{p.name}</div>
                    {p.articleGroup && (
                      <div className="text-xs text-muted-foreground">{p.articleGroup}</div>
                    )}
                  </button>
                ))}
                {productInput.trim() && !filteredProducts.some((p) => p.name.toLowerCase() === productInput.toLowerCase()) && (
                  <button
                    className="w-full border-t px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={addCustomProduct}
                  >
                    <span className="text-muted-foreground">+ </span>
                    <span className="font-medium">&quot;{productInput.trim()}&quot;</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Loading overlay */}
      {loading && activeProducts.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <RiLoader4Line className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Copy Week Dialog */}
      <CopyWeekDialog
        open={showCopyDialog}
        onOpenChange={setShowCopyDialog}
        weeksWithData={weeksWithData}
        supplierId={supplierId}
        onCopied={() => { refetch(); refetchYear(); }}
      />
    </div>
  );
}

function getISOWeeksInYear(year: number): number {
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  return jan1.getDay() === 4 || dec31.getDay() === 4 ? 53 : 52;
}
