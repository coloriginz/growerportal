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

interface SalesChartProps {
  data: {
    month: string;
    stems: number;
    turnover: number;
    lastYearStems: number;
    lastYearTurnover: number;
  }[];
}

export function SalesChart({ data }: SalesChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => formatNumber(v)} />
        <Tooltip
          formatter={(value: unknown, name: unknown) => {
            if (String(name).includes("Turnover")) return formatCurrency(value as number);
            return formatNumber(value as number);
          }}
        />
        <Legend />
        <Bar
          dataKey="stems"
          name="Stems 2026"
          fill="oklch(0.546 0.245 262.881)"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="lastYearStems"
          name="Stems 2025"
          fill="oklch(0.809 0.105 251.813)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
