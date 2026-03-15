"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency, formatNumber } from "@/lib/format";
import { getChartColor, getChartColorWithOpacity } from "@/lib/chart-colors";

interface SalesChartProps {
  data: {
    month: string;
    stems: number;
    turnover: number;
    lastYearStems: number;
    lastYearTurnover: number;
  }[];
}

// Custom tooltip with polished styling
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-card px-3 py-2.5 shadow-lg">
      <p className="mb-1.5 text-xs font-semibold text-foreground">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium tabular-nums text-foreground">
            {entry.name.includes("Turnover")
              ? formatCurrency(entry.value)
              : formatNumber(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SalesChart({ data }: SalesChartProps) {
  const currentYear = new Date().getFullYear();
  const lastYear = currentYear - 1;
  const color1 = getChartColor(0);
  const color1Faded = getChartColorWithOpacity(0, 0.35);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
        <XAxis
          dataKey="month"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "currentColor" }} className="text-muted-foreground"
        />
        <YAxis
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatNumber(v)}
          tick={{ fill: "currentColor" }} className="text-muted-foreground"
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
        />
        <Bar
          dataKey="stems"
          name={`Stems ${currentYear}`}
          fill={color1}
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="lastYearStems"
          name={`Stems ${lastYear}`}
          fill={color1Faded}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
