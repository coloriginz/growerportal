"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { formatNumber } from "@/lib/format";

interface TopProductsChartProps {
  data: { name: string; stems: number; turnover: number }[];
}

// Gradient of green shades from the nature palette
const BAR_COLORS = [
  "oklch(0.45 0.12 155)",
  "oklch(0.50 0.12 155)",
  "oklch(0.55 0.11 155)",
  "oklch(0.60 0.10 155)",
  "oklch(0.65 0.09 155)",
  "oklch(0.70 0.08 155)",
  "oklch(0.75 0.07 155)",
  "oklch(0.80 0.06 155)",
];

// Custom tooltip with polished styling
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-card px-3 py-2.5 shadow-lg">
      <p className="mb-1 text-xs font-semibold text-foreground">{label}</p>
      <p className="text-xs tabular-nums text-muted-foreground">
        {formatNumber(payload[0].value)} stems
      </p>
    </div>
  );
}

export function TopProductsChart({ data }: TopProductsChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical" barSize={20}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="oklch(0.91 0.01 80 / 0.8)" />
        <XAxis
          type="number"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatNumber(v)}
          tick={{ fill: "oklch(0.50 0.02 60)" }}
        />
        <YAxis
          type="category"
          dataKey="name"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={120}
          tick={{ fill: "oklch(0.50 0.02 60)" }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar
          dataKey="stems"
          name="Stems"
          radius={[0, 4, 4, 0]}
        >
          {data.map((_, index) => (
            <Cell key={index} fill={BAR_COLORS[index % BAR_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
