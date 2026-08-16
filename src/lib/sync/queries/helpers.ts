/** Datum als YYYY-MM-DD in UTC, zodat de tijdzone van de server niet meetelt. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Geeft het id terug als het een veilig geheel getal is, anders null. Dit is het
 * enige wat tussen een id en willekeurige SQL staat, dus het gaat door Number()
 * heen en wijst alles af wat geen veilig geheel getal is (inclusief
 * exponentnotatie, Infinity, NaN en waarden boven Number.MAX_SAFE_INTEGER).
 * Geen Math.trunc: een niet-geheel getal wordt geweigerd, niet afgekapt.
 */
export function safeSupplierId(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** Zet een leveranciers-id om naar een veilig SQL-fragment voor een directe kolomvergelijking. */
export function supplierClause(
  column: string,
  supplierFabricId: number | null | undefined
): string {
  const id = safeSupplierId(supplierFabricId);
  if (id === null) return "";
  return `AND ${column} = ${id}`;
}

/**
 * De kostentabel heeft zelf geen leverancier — die hangt aan de levering. De
 * koppeling loopt daarom via parthdr_id in marts.fct_partijen.
 */
export function supplierViaPartijenClause(value: number | null | undefined): string {
  const id = safeSupplierId(value);
  if (id === null) return "";
  return `AND parthdr_id IN (SELECT parthdr_id FROM marts.fct_partijen WHERE rel_id_leverancier = ${id})`;
}

/**
 * dim_kweker heeft geen rel_id_leverancier — die koppeling loopt via de
 * partijen die de kweker heeft geleverd aan die leverancier.
 */
export function growerViaPartijenClause(value: number | null | undefined): string {
  const id = safeSupplierId(value);
  if (id === null) return "";
  return `AND rel_id_kweker IN (SELECT rel_id_kweker FROM marts.fct_partijen WHERE rel_id_leverancier = ${id})`;
}
