import { NextRequest, NextResponse } from "next/server";

/**
 * Validate import API key from request header.
 * Set IMPORT_API_KEY in environment variables.
 * Power Automate sends: Authorization: Bearer <key>
 */
export function requireImportAuth(request: NextRequest): NextResponse | null {
  const apiKey = process.env.IMPORT_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Import API key not configured on server" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== apiKey) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  return null; // auth OK
}

/**
 * Reduce a column name to a form that ignores how the source spelled it.
 *
 * The same field reaches us under different names depending on where the data
 * comes from. A DAX query wraps names in brackets, the SQL warehouse returns
 * the raw column, and the schemas here were written in a third style again:
 *
 *   "[Shkost ID]"       (DAX)     ->  shkostid
 *   "shkost_id"         (SQL)     ->  shkostid
 *   "Shkost_x0020_ID"   (XML)     ->  shkostid
 *   "Shkost ID"         (schema)  ->  shkostid
 *
 * The XML form appears when a column name containing a space passes through a
 * step that encodes it as an XML element name: a space becomes `_x0020_`, the
 * standard `_xHHHH_` escape. Those are decoded first, because `x0020` would
 * otherwise survive as literal text and never match anything.
 *
 * After that, stripping separators and case is enough to make the spellings
 * meet. Fields that are genuinely named differently need an explicit alias —
 * see the alias map in the route that owns them.
 */
function canonicalKey(key: string): string {
  return key
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/[[\]\s_/.-]/g, "")
    .toLowerCase();
}

/**
 * Rewrite the keys of incoming rows to the names a Zod schema expects.
 *
 * Pass `Object.keys(schema.shape)` so the accepted names follow the schema
 * automatically instead of living in a second list that drifts out of sync.
 *
 * Keys that match nothing are left untouched rather than dropped: Zod ignores
 * unknown keys anyway, and keeping them means the error summary below can show
 * what the source actually sent.
 */
export function normalizeImportKeys<T>(
  rows: unknown[],
  schemaKeys: readonly string[],
  aliases: Readonly<Record<string, readonly string[]>> = {}
): T[] {
  const lookup = new Map<string, string>();
  for (const key of schemaKeys) lookup.set(canonicalKey(key), key);
  // Aliases are registered after the schema keys so an alias can never shadow
  // a field that already matches on its own name.
  for (const [schemaKey, alternatives] of Object.entries(aliases)) {
    for (const alternative of alternatives) {
      const canonical = canonicalKey(alternative);
      if (!lookup.has(canonical)) lookup.set(canonical, schemaKey);
    }
  }

  return rows.map((row) => {
    if (row === null || typeof row !== "object") return row as T;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      out[lookup.get(canonicalKey(key)) ?? key] = value;
    }
    return out as T;
  });
}

/**
 * Turn a validation failure into something a human can act on.
 *
 * Zod reports one issue per row per field, so a payload where every row misses
 * the same three fields produces thousands of identical lines — 11.949 of them
 * the first time the SQL flow ran, which said nothing about which field was
 * missing or what the source had sent instead.
 *
 * This groups by field, counts the rows, and lists the keys that did arrive.
 * That turns "expected number, received undefined" into a message that names
 * the mismatch outright.
 */
export function summariseImportError(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  rows: unknown[],
  schemaKeys: readonly string[]
): string {
  const grouped = new Map<string, { field: string; message: string; rows: number }>();
  for (const issue of issues) {
    // path is [collection, rowIndex, field]; the field is the last string in it.
    const field = [...issue.path].reverse().find((p) => typeof p === "string");
    const key = `${String(field ?? "?")}|${issue.message}`;
    const existing = grouped.get(key);
    if (existing) existing.rows++;
    else grouped.set(key, { field: String(field ?? "?"), message: issue.message, rows: 1 });
  }

  const first = rows.find((r) => r !== null && typeof r === "object");
  const received = first ? Object.keys(first as Record<string, unknown>) : [];
  const missing = schemaKeys.filter(
    (k) => first && !(k in (first as Record<string, unknown>))
  );

  return JSON.stringify({
    rowsReceived: rows.length,
    // Capped: a broken payload can fail on every field, and the message is
    // stored on ImportBatch where an unbounded blob helps nobody.
    problems: [...grouped.values()].sort((a, b) => b.rows - a.rows).slice(0, 10),
    keysReceived: received.slice(0, 40),
    keysMissing: missing,
  });
}
