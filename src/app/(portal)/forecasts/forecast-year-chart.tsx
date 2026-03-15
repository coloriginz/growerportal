"use client";

import { useMemo, useCallback, useRef, useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import { formatNumber } from "@/lib/format";
import { getChartColor, getChartColorWithOpacity } from "@/lib/chart-colors";
import { useLanguage } from "@/components/providers/language-provider";

interface Forecast {
  productName: string;
  articleGroup: string | null;
  year: number;
  week: number;
  stems: number;
}

interface ForecastYearChartProps {
  forecasts: Forecast[];
  year: number;
  currentWeek: number;
  visibleStartWeek: number;
  onWeekClick: (week: number) => void;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const entries = payload.filter((e) => e.value > 0);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-card px-3 py-2.5 shadow-lg">
      <p className="mb-1.5 text-xs font-semibold text-foreground">{label}</p>
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium tabular-nums text-foreground">
            {formatNumber(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ForecastYearChart({
  forecasts,
  year,
  currentWeek,
  visibleStartWeek,
  onWeekClick,
}: ForecastYearChartProps) {
  const { t } = useLanguage();
  const chartRef = useRef<HTMLDivElement>(null);
  const [colors, setColors] = useState<string[]>([]);
  const [colorsBg, setColorsBg] = useState<string[]>([]);

  // Get unique product names
  const productNames = useMemo(() => {
    const names = new Set<string>();
    for (const f of forecasts) {
      names.add(f.productName);
    }
    return Array.from(names).sort();
  }, [forecasts]);

  // Resolve chart colors on mount (needs DOM)
  useEffect(() => {
    setColors(productNames.map((_, i) => getChartColor(i)));
    setColorsBg(productNames.map((_, i) => getChartColorWithOpacity(i, 0.15)));
  }, [productNames]);

  // Build chart data: one entry per week (1-52)
  const chartData = useMemo(() => {
    const maxWeek = 52;
    const data: Record<string, string | number>[] = [];

    for (let w = 1; w <= maxWeek; w++) {
      const entry: Record<string, string | number> = {
        name: `W${w}`,
        week: w,
      };
      for (const product of productNames) {
        const forecast = forecasts.find(
          (f) => f.productName === product && f.year === year && f.week === w
        );
        entry[product] = forecast?.stems ?? 0;
      }
      data.push(entry);
    }
    return data;
  }, [forecasts, year, productNames]);

  const handleChartClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (state: any) => {
      if (!state?.activeLabel) return;
      const label = String(state.activeLabel);
      const weekNum = parseInt(label.replace("W", ""));
      if (!isNaN(weekNum)) {
        onWeekClick(weekNum);
      }
    },
    [onWeekClick]
  );

  if (productNames.length === 0) return null;

  const visibleEndWeek = Math.min(visibleStartWeek + 5, 52);

  return (
    <div ref={chartRef} className="mt-6 rounded-lg border p-4">
      <h3 className="mb-3 text-sm font-semibold">
        {t("forecasts.title")} {year}
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart
          data={chartData}
          onClick={handleChartClick}
          style={{ cursor: "pointer" }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            className="stroke-border/50"
          />
          <XAxis
            dataKey="name"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "currentColor" }}
            className="text-muted-foreground"
            interval={3}
          />
          <YAxis
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => (v > 0 ? formatNumber(v) : "")}
            tick={{ fill: "currentColor" }}
            className="text-muted-foreground"
            width={45}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Highlight visible range */}
          <ReferenceArea
            x1={`W${visibleStartWeek}`}
            x2={`W${visibleEndWeek}`}
            fill="currentColor"
            fillOpacity={0.06}
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeDasharray="3 3"
          />

          {/* Current week marker */}
          <ReferenceLine
            x={`W${currentWeek}`}
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeDasharray="4 4"
          />

          {productNames.map((product, index) => (
            <Area
              key={product}
              type="monotone"
              dataKey={product}
              name={product}
              stroke={colors[index] || "oklch(0.55 0.15 155)"}
              fill={colorsBg[index] || "oklch(0.55 0.15 155 / 0.15)"}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-[10px] text-muted-foreground">
        {t("forecasts.clickToNavigate")}
      </p>
    </div>
  );
}
