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
import { formatCurrency } from "@/lib/format";
import { getChartColor, getChartColorWithOpacity } from "@/lib/chart-colors";

interface TurnoverChartProps {
  data: {
    label: string;
    stems: number;
    turnover: number;
    lastYearStems: number;
    lastYearTurnover: number;
  }[];
}

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
            {formatCurrency(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TurnoverChart({ data }: TurnoverChartProps) {
  const currentYear = new Date().getFullYear();
  const lastYear = currentYear - 1;
  const color = getChartColor(1);
  const colorFaded = getChartColorWithOpacity(1, 0.35);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
        <XAxis
          dataKey="label"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "currentColor" }} className="text-muted-foreground"
        />
        <YAxis
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatCurrency(v)}
          tick={{ fill: "currentColor" }} className="text-muted-foreground"
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
        />
        <Bar
          dataKey="turnover"
          name={`Turnover ${currentYear}`}
          fill={color}
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="lastYearTurnover"
          name={`Turnover ${lastYear}`}
          fill={colorFaded}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
