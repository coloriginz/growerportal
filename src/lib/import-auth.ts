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
 * Strip square brackets from object keys.
 * DAX query results from Power Automate wrap column names in brackets:
 * { "[Naam]": "value" } → { "Naam": "value" }
 */
export function stripBracketKeys<T>(rows: T[]): T[] {
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      const cleanKey = key.replace(/^\[|\]$/g, "");
      obj[cleanKey] = value;
    }
    return obj as T;
  });
}
