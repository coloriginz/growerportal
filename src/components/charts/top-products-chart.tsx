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
import { getChartColor } from "@/lib/chart-colors";

interface TopProductsChartProps {
  data: { name: string; stems: number; turnover: number }[];
}

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
        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border/50" />
        <XAxis
          type="number"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatNumber(v)}
          tick={{ fill: "currentColor" }} className="text-muted-foreground"
        />
        <YAxis
          type="category"
          dataKey="name"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={120}
          tick={{ fill: "currentColor" }} className="text-muted-foreground"
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar
          dataKey="stems"
          name="Stems"
          radius={[0, 4, 4, 0]}
        >
          {data.map((_, index) => (
            <Cell key={index} fill={getChartColor(index)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
