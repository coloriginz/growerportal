export function getChartColor(index: number): string {
  if (typeof window === "undefined") return "oklch(0.55 0.15 155)";
  const varName = `--chart-${(index % 5) + 1}`;
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || "oklch(0.55 0.15 155)";
}

export function getChartColorWithOpacity(index: number, opacity: number): string {
  const color = getChartColor(index);
  return `${color.replace(")", ` / ${opacity})`)}`;
}
