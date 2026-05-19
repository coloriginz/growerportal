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

interface StemLengthChartProps {
  data: { length: string; stems: number; turnover: number; avgPrice: number }[];
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-lg border border-border/50 bg-card px-3 py-2.5 shadow-lg">
      <p className="mb-1 text-xs font-semibold text-foreground">{label}</p>
      <p className="text-xs tabular-nums text-muted-foreground">
        {formatNumber(item.value)} stems
      </p>
    </div>
  );
}

export function StemLengthChart({ data }: StemLengthChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
        <XAxis
          dataKey="length"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "currentColor" }}
          className="text-muted-foreground"
        />
        <YAxis
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatNumber(v)}
          tick={{ fill: "currentColor" }}
          className="text-muted-foreground"
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar dataKey="stems" name="Stems" radius={[4, 4, 0, 0]}>
          {data.map((_, index) => (
            <Cell key={index} fill={getChartColor(index)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
