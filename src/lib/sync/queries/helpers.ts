/** Datum als YYYY-MM-DD in UTC, zodat de tijdzone van de server niet meetelt. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Zet een leveranciers-id om naar een veilig SQL-fragment. Dit is het enige wat
 * tussen een id en willekeurige SQL staat, dus het gaat door Number() heen en
 * levert bij alles wat geen eindig getal is een lege clausule op.
 */
export function supplierClause(
  column: string,
  supplierFabricId: number | null | undefined
): string {
  if (supplierFabricId === null || supplierFabricId === undefined) return "";
  const id = Number(supplierFabricId);
  if (!Number.isFinite(id)) return "";
  return `AND ${column} = ${Math.trunc(id)}`;
}
