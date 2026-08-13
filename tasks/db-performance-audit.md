# Database & Performance Audit Report

**Date:** 2026-05-23
**Auditor:** Claude Opus 4.6 (Senior Database Engineer)
**Scope:** All API routes, Prisma schema, connection management, query patterns
**Focus:** N+1 queries, missing indexes, unbounded result sets, performance at 10x scale

---

## Executive Summary

The codebase is **well-architected for its current scale**. Import routes use efficient bulk raw SQL (jsonb_array_elements pattern), most read queries use `select` to limit columns, and the schema has good index coverage on foreign keys. However, there are **5 critical/high issues** that will cause problems at 10x data volume, plus several medium issues worth addressing proactively.

**Key findings:**
- 1 CRITICAL: N+1 loop in dashboard chart (year view) -- 24 sequential DB queries
- 3 HIGH: N+1 loops in fust pickup/delivery routes, forecast upserts, and grower import
- 2 HIGH: Unbounded `findMany` calls that fetch ALL transactions/quality issues
- 4 MEDIUM: Missing composite indexes for common query patterns
- Several LOW: Minor inefficiencies and missing pagination

---

## 1. N+1 QUERIES

### Finding 1.1 -- Dashboard Chart Year View: 24 Sequential Queries in a Loop

- **Severity:** CRITICAL
- **Location:** `src/app/api/dashboard/chart/route.ts:77-99`
- **Description:** The year chart view loops through 12 months and fires 2 aggregate queries per month (current year + last year), totaling **24 sequential database roundtrips**.
- **Current behavior:** Each month executes `prisma.transaction.aggregate()` inside a `for` loop. At current data volume (~400k transactions), each aggregate scans the Transaction table. Total response time is 24x the per-query latency.
- **At scale impact:** With 4M transactions, each aggregate query takes longer, and 24 of them in sequence could push response times to 5-10+ seconds. Neon serverless has ~5ms network overhead per query, so 24 queries add ~120ms of pure network overhead alone.
- **Fix:** Replace the loop with a single raw SQL query that groups by month:

```sql
SELECT
  EXTRACT(MONTH FROM date) AS month,
  EXTRACT(YEAR FROM date) AS year,
  SUM(stems) AS total_stems,
  SUM(amount) AS total_amount
FROM "Transaction" t
JOIN "Lot" l ON t."lotId" = l.id
WHERE l."supplierId" = $1
  AND t.date >= $2 AND t.date < $3
GROUP BY EXTRACT(YEAR FROM date), EXTRACT(MONTH FROM date)
ORDER BY year, month
```

This replaces 24 queries with 2 (current year + last year), or even 1 query covering both years with a CASE expression.

---

### Finding 1.2 -- Fust Pickup POST: N+1 Loop for Order Linking

- **Severity:** HIGH
- **Location:** `src/app/api/fust/pickups/route.ts:111-141`
- **Description:** When creating a pickup with orderIds, each orderId triggers 3 sequential queries inside a loop: `findUnique` (check existing delivery), `update` or `create` (delivery), and `update` (order status). For N orders, this is **3N queries**.
- **Current behavior:** Fust orders are low volume (<100/month), so this works fine today.
- **At scale impact:** If a pickup includes 20+ orders (batch pickups), this becomes 60+ sequential queries. Combined with audit logging (another N queries per order), total could exceed 100 queries for a single POST.
- **Fix:** Batch the operations:

```typescript
// 1. Fetch all existing deliveries for these orderIds in one query
const existingDeliveries = await prisma.fustDelivery.findMany({
  where: { orderId: { in: orderIds } },
});
const existingMap = new Map(existingDeliveries.map(d => [d.orderId, d]));

// 2. Split into creates and updates
const toCreate = orderIds.filter(id => !existingMap.has(id));
const toUpdate = orderIds.filter(id => existingMap.has(id));

// 3. Batch create + batch update + batch order status update
await Promise.all([
  toCreate.length > 0 && prisma.fustDelivery.createMany({
    data: toCreate.map(orderId => ({ orderId, pickupId: pickup.id, status: "pending" })),
  }),
  toUpdate.length > 0 && prisma.fustDelivery.updateMany({
    where: { orderId: { in: toUpdate } },
    data: { pickupId: pickup.id },
  }),
  prisma.fustOrder.updateMany({
    where: { id: { in: orderIds } },
    data: { status: "scheduled" },
  }),
]);
```

---

### Finding 1.3 -- Fust Pickup PATCH: N+1 Loop for Status Transitions

- **Severity:** HIGH
- **Location:** `src/app/api/fust/pickups/[id]/route.ts:102-153`
- **Description:** When status changes to "picked_up", each delivery in the pickup gets 3 sequential queries: `update` delivery status, `update` order status, `logFustEvent`. For N deliveries, this is **3N sequential queries**.
- **Current behavior:** Pickups typically have 3-10 deliveries, so this is 9-30 queries.
- **At scale impact:** Larger batch pickups with 20+ deliveries will cause 60+ sequential queries.
- **Fix:** Use `updateMany` for the status changes, then batch the audit logs:

```typescript
if (status === "picked_up") {
  const deliveryIds = pickup.deliveries.map(d => d.id);
  const orderIds = pickup.deliveries.map(d => d.orderId);
  await Promise.all([
    prisma.fustDelivery.updateMany({
      where: { id: { in: deliveryIds } },
      data: { status: "in_transit" },
    }),
    prisma.fustOrder.updateMany({
      where: { id: { in: orderIds } },
      data: { status: "in_transit" },
    }),
  ]);
  // Batch audit logs via createMany
  await prisma.fustAuditLog.createMany({
    data: pickup.deliveries.map(d => ({
      entityType: "delivery", entityId: d.id, orderId: d.orderId,
      action: "delivery_in_transit", actorId: session.user.id,
      actorName: session.user.name, metadata: { pickupId: id },
    })),
  });
}
```

---

### Finding 1.4 -- Fust Order PATCH (Delivered): N+1 Loop for Order Items

- **Severity:** MEDIUM
- **Location:** `src/app/api/fust/orders/[id]/route.ts:107-125`
- **Description:** When marking an order as delivered, each item gets an individual `updateMany` or `update` call inside a loop. For N items, this is N sequential queries.
- **Current behavior:** Orders typically have 2-5 items, so this is manageable.
- **At scale impact:** Low impact since item count per order is naturally bounded. Still worth batching for cleanliness.
- **Fix:** Use `$transaction` to batch the updates:

```typescript
if (items && items.length > 0) {
  await prisma.$transaction(
    items.map(item =>
      prisma.fustOrderItem.updateMany({
        where: { orderId: id, fustTypeId: item.fustTypeId },
        data: { deliveredQuantity: item.deliveredQuantity },
      })
    )
  );
}
```

---

### Finding 1.5 -- Forecast POST: Sequential Upserts in Loop

- **Severity:** HIGH
- **Location:** `src/app/api/forecasts/route.ts:137-179`
- **Description:** Each forecast in the batch is individually upserted via `prisma.shipmentForecast.upsert()` in a sequential loop. When a user saves a full grid (e.g., 10 products x 6 weeks = 60 cells), this fires **60 sequential queries**.
- **Current behavior:** Users typically save per-cell (1 upsert), but the batch endpoint supports multi-cell saves. The copy endpoint (`/api/forecasts/copy`) has the same issue (line 73-101): N products x M weeks = N*M sequential upserts.
- **At scale impact:** Copy 10 products x 12 weeks = 120 sequential upserts. With Neon latency, this could take 2-3 seconds.
- **Fix:** Use raw SQL `INSERT ... ON CONFLICT` with jsonb_array_elements (same pattern as the import routes):

```sql
INSERT INTO "ShipmentForecast" (id, "supplierId", "productName", "articleGroup", year, week, stems, trolleys, colli, "createdById", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  v.val->>'supplierId',
  v.val->>'productName',
  v.val->>'articleGroup',
  (v.val->>'year')::int,
  (v.val->>'week')::int,
  (v.val->>'stems')::int,
  (v.val->>'trolleys')::int,
  (v.val->>'colli')::int,
  v.val->>'createdById',
  NOW(), NOW()
FROM jsonb_array_elements($1::jsonb) AS v(val)
ON CONFLICT ("supplierId", "productName", year, week) DO UPDATE SET
  stems = EXCLUDED.stems,
  trolleys = EXCLUDED.trolleys,
  colli = EXCLUDED.colli,
  "articleGroup" = EXCLUDED."articleGroup",
  "updatedAt" = NOW()
```

Handle the "delete when all zero" case separately with a `DELETE ... WHERE` for zero-value entries.

---

### Finding 1.6 -- Grower Import: Sequential Updates in Loop

- **Severity:** HIGH
- **Location:** `src/app/api/import/growers/route.ts:88-123`
- **Description:** Each existing grower that needs updating gets an individual `prisma.grower.update()` call inside a loop. Unlike the other import routes (lots, orders, costs, suppliers), which use bulk raw SQL updates, this route uses sequential Prisma updates.
- **Current behavior:** Works for small grower counts. With 100+ growers needing updates, this is 100+ sequential queries.
- **At scale impact:** With 500+ growers, this could take 5+ seconds.
- **Fix:** Use the same `$executeRawUnsafe` + jsonb pattern as the other import routes:

```typescript
const updateData = [];
for (const existing of existingGrowers) {
  const row = incomingMap.get(existing.fabricId!);
  if (!row) continue;
  // ... check hasChanges ...
  if (hasChanges) {
    updateData.push({
      fabricId: existing.fabricId,
      name: row.Naam,
      code: row.Code,
      country: row["Land Naam"] || null,
      city: row.Plaats || null,
    });
  }
}

if (updateData.length > 0) {
  await prisma.$executeRawUnsafe(
    `UPDATE "Grower" AS t
     SET name = u.val->>'name', code = u.val->>'code',
         country = u.val->>'country', city = u.val->>'city',
         "updatedAt" = NOW()
     FROM jsonb_array_elements($1::jsonb) AS u(val)
     WHERE t."fabricId" = (u.val->>'fabricId')::int`,
    JSON.stringify(updateData)
  );
}
```

---

### Finding 1.7 -- Fust Delivery PATCH: Sequential Upserts for Delivery Items

- **Severity:** LOW
- **Location:** `src/app/api/fust/deliveries/[id]/route.ts:77-93`
- **Description:** Each delivery item is individually upserted in a loop. Typically 2-5 items per delivery.
- **Current behavior:** Works fine at current scale.
- **At scale impact:** Minimal -- item count per delivery is naturally bounded.
- **Fix:** Batch with `$transaction` or accept the current pattern given the small N.

---

### Finding 1.8 -- Voucher Match: Sequential Upsert + Audit per Order

- **Severity:** LOW
- **Location:** `src/app/api/fust/vouchers/[id]/match/route.ts:40-61`
- **Description:** Each orderId gets an individual `upsert` + `logFustEvent` call. Typically 1-5 orders per voucher match.
- **Current behavior:** Works fine.
- **At scale impact:** Minimal.
- **Fix:** Could use `createMany` with `skipDuplicates: true` for the links, but current approach is acceptable.

---

## 2. UNBOUNDED RESULT SETS

### Finding 2.1 -- Sales Route: Fetches ALL Transactions into Memory

- **Severity:** HIGH
- **Location:** `src/app/api/sales/route.ts:167-171`
- **Description:** The daily breakdown section fetches ALL transactions matching the date range into memory with `findMany`, then iterates in JavaScript to build the daily map. For YTD with a Jan 1 start, this could be **200k+ transactions** loaded into a single serverless function.
- **Current behavior:** With ~400k total transactions, a YTD query for a large supplier could return 10k-50k rows. The select is minimal (date, stems, amount), so memory impact is moderate.
- **At scale impact:** With 4M transactions, a YTD query could return 100k-500k rows. This will: (a) exhaust serverless function memory (256MB-1GB), (b) cause Neon connection timeouts, (c) cause extremely slow response times.
- **Fix:** Replace with a SQL aggregation:

```sql
SELECT DATE(date) AS day, SUM(stems) AS stems, SUM(amount) AS amount
FROM "Transaction" t
JOIN "Lot" l ON t."lotId" = l.id
WHERE l."supplierId" = $1 AND t.date >= $2
GROUP BY DATE(date)
ORDER BY day
```

This returns at most ~365 rows instead of 500k+. Apply the same fix to the last-year comparison query on lines 250-259.

---

### Finding 2.2 -- Sales Trends: Fetches ALL Transactions with Lot Join

- **Severity:** HIGH
- **Location:** `src/app/api/sales/trends/route.ts:59-69`
- **Description:** Fetches ALL transactions for the date range with a nested lot select (productName, stemLength). For YTD, this could be 50k-500k rows, each with a joined lot record.
- **Current behavior:** Works at current scale but is already likely the slowest endpoint.
- **At scale impact:** Will break with 4M transactions. Each row includes the lot join overhead.
- **Fix:** Use SQL aggregation with multiple GROUP BY queries for each chart type (priceTrend, stemLengthBreakdown, channelDistribution):

```sql
-- Price trend by product and period
SELECT
  l."productName",
  DATE_TRUNC('week', t.date) AS period,
  SUM(t.stems) AS stems,
  SUM(t.amount) AS amount
FROM "Transaction" t
JOIN "Lot" l ON t."lotId" = l.id
WHERE l."supplierId" = $1 AND t.date >= $2
GROUP BY l."productName", period

-- Stem length breakdown
SELECT
  l."stemLength",
  SUM(t.stems) AS stems,
  SUM(t.amount) AS amount
FROM "Transaction" t
JOIN "Lot" l ON t."lotId" = l.id
WHERE l."supplierId" = $1 AND t.date >= $2
GROUP BY l."stemLength"

-- Channel distribution by period
SELECT
  t."salesType",
  DATE_TRUNC('week', t.date) AS period,
  SUM(t.stems) AS stems
FROM "Transaction" t
JOIN "Lot" l ON t."lotId" = l.id
WHERE l."supplierId" = $1 AND t.date >= $2
GROUP BY t."salesType", period
```

Three focused queries returning small result sets, vs one massive query returning all rows.

---

### Finding 2.3 -- Quality Route: Fetches ALL Quality Issues

- **Severity:** MEDIUM
- **Location:** `src/app/api/quality/route.ts:23-29`
- **Description:** Fetches ALL quality issues for a supplier with no pagination or limit. While quality issues are lower volume than transactions, there is no upper bound.
- **Current behavior:** Likely <1000 issues per supplier.
- **At scale impact:** If a supplier accumulates 10k+ quality issues over years, this will become slow.
- **Fix:** Add pagination or a date range filter, and use `aggregate` for the summary instead of filtering in JavaScript (lines 39-68).

---

### Finding 2.4 -- Fust Orders GET: No Pagination

- **Severity:** MEDIUM
- **Location:** `src/app/api/fust/orders/route.ts:78-104`
- **Description:** Fetches ALL non-deleted fust orders with deep includes (items with fustType, supplier, delivery with items, voucherLinks with voucher). No `take` limit.
- **Current behavior:** Works fine with <200 orders.
- **At scale impact:** With 1000+ orders, the deep include chain will cause large result sets and slow queries.
- **Fix:** Add cursor-based or offset pagination with a default limit of 50.

---

### Finding 2.5 -- Fust Vouchers GET: No Pagination

- **Severity:** MEDIUM
- **Location:** `src/app/api/fust/vouchers/route.ts:27-53`
- **Description:** Fetches ALL vouchers with deep includes (items with fustType, orderLinks with order with supplier and items). No `take` limit.
- **Fix:** Add pagination with default limit.

---

### Finding 2.6 -- Fust Pickups GET: No Pagination

- **Severity:** MEDIUM
- **Location:** `src/app/api/fust/pickups/route.ts:46-65`
- **Description:** Fetches ALL pickups with deeply nested includes (deliveries -> order -> items -> fustType + supplier, delivery items -> fustType). No `take` limit.
- **Fix:** Add pagination with default limit.

---

### Finding 2.7 -- Fust Invoices GET: No Pagination

- **Severity:** MEDIUM
- **Location:** `src/app/api/fust/invoices/route.ts:22-37`
- **Description:** Fetches ALL invoices with includes. No `take` limit.
- **Fix:** Add pagination with default limit.

---

### Finding 2.8 -- Fust Grower Invoices GET: No Pagination

- **Severity:** LOW
- **Location:** `src/app/api/fust/grower-invoices/route.ts:64-89`
- **Description:** No `take` limit. Returns all invoices matching filters.
- **Fix:** Add pagination.

---

### Finding 2.9 -- Documents GET: No Pagination

- **Severity:** LOW
- **Location:** `src/app/api/documents/route.ts:21-24`
- **Description:** Returns all documents for a supplier with no limit.
- **Fix:** Add `take: 200` or pagination.

---

## 3. MISSING INDEXES

### Finding 3.1 -- Transaction: Missing Composite Index (lotId, date)

- **Severity:** MEDIUM
- **Location:** `prisma/schema.prisma` -- Transaction model (lines 322-342)
- **Description:** The most common query pattern for transactions is filtering by `lot.supplierId` + `date` range. This joins Lot and Transaction on lotId, then filters by date. While individual indexes exist on `lotId` and `date`, a composite index would allow PostgreSQL to narrow results much faster.
- **Current indexes:** `@@index([lotId])`, `@@index([date])`, `@@index([salesType])`, `@@index([fabricOrdregId])`
- **Recommended addition:**

```prisma
@@index([lotId, date])
```

---

### Finding 3.2 -- Transaction: Missing Index on createdAt

- **Severity:** MEDIUM
- **Location:** `prisma/schema.prisma` -- Transaction model
- **Description:** The aggregate dashboard route queries transactions with `orderBy: { createdAt: "desc" }` (dashboard/route.ts:203). Without an index, this requires a full table sort.
- **Recommended addition:**

```prisma
@@index([createdAt])
```

---

### Finding 3.3 -- Lot: Missing Index on createdAt

- **Severity:** LOW
- **Location:** `prisma/schema.prisma` -- Lot model
- **Description:** The aggregate dashboard queries lots with `orderBy: { createdAt: "desc" }` (dashboard/route.ts:228). No index on `createdAt`.
- **Recommended addition:**

```prisma
@@index([createdAt])
```

---

### Finding 3.4 -- FustIssuanceVoucherItem: Missing Index on voucherId

- **Severity:** LOW
- **Location:** `prisma/schema.prisma` -- FustIssuanceVoucherItem model (lines 720-729)
- **Description:** No index on `voucherId`. When fetching a voucher with included items, PostgreSQL scans the full items table.
- **Recommended addition:**

```prisma
@@index([voucherId])
```

---

### Finding 3.5 -- FustInvoiceItem: Missing Index on invoiceId

- **Severity:** LOW
- **Location:** `prisma/schema.prisma` -- FustInvoiceItem model (lines 591-600)
- **Description:** No index on `invoiceId`. Same issue as above for invoice items.
- **Recommended addition:**

```prisma
@@index([invoiceId])
```

---

### Finding 3.6 -- Supplier: Missing Index on accountManagerCode

- **Severity:** MEDIUM
- **Location:** `prisma/schema.prisma` -- Supplier model (lines 67-125)
- **Description:** The `buildSupplierScope()` function (api-helpers.ts:57) filters suppliers by `accountManagerCode` for commercie users. This field has no index. **Every API call by a commercie user** triggers a filter on this column.
- **Recommended addition:**

```prisma
@@index([accountManagerCode])
```

---

## 4. QUERY EFFICIENCY

### Finding 4.1 -- Sales/Dashboard: GroupBy lotId Then Re-fetching Lots

- **Severity:** MEDIUM
- **Location:** `src/app/api/sales/route.ts:118-138`, `src/app/api/dashboard/route.ts:85-126`, `src/app/api/dashboard/chart/route.ts:157-180`
- **Description:** The "by product" breakdown first groups transactions by `lotId` using `groupBy`, then fetches all matching lots in a second query to get `productName`/`articleGroup`. This is a repeated pattern in 3+ routes. While it avoids N+1 (uses `in` clause), it could be a single raw SQL query with a JOIN.
- **Current behavior:** 2 queries instead of 1. The lot IDs list could grow to 10k+ for large YTD queries.
- **Fix:** Use raw SQL with JOIN to aggregate by product directly:

```sql
SELECT l."articleGroup", SUM(t.stems) AS stems, SUM(t.amount) AS amount
FROM "Transaction" t
JOIN "Lot" l ON t."lotId" = l.id
WHERE l."supplierId" = $1 AND t.date >= $2
GROUP BY l."articleGroup"
ORDER BY stems DESC
LIMIT 8
```

---

### Finding 4.2 -- Forecast GET: Two Redundant Distinct Product Queries

- **Severity:** LOW
- **Location:** `src/app/api/forecasts/route.ts:80-94`
- **Description:** Fetches distinct products from both Lot AND ShipmentForecast tables, then merges in JavaScript. Could be a single UNION query.
- **Fix:**

```sql
SELECT DISTINCT "productName", "articleGroup"
FROM (
  SELECT "productName", "articleGroup" FROM "Lot" WHERE "supplierId" = $1
  UNION
  SELECT "productName", "articleGroup" FROM "ShipmentForecast" WHERE "supplierId" = $1
) AS combined
ORDER BY "productName"
```

---

## 5. CONNECTION MANAGEMENT

### Finding 5.1 -- Prisma Client Singleton: Correct Pattern

- **Severity:** N/A (No Issue)
- **Location:** `src/lib/db.ts`
- **Description:** The singleton pattern is correct for serverless: uses `globalThis` to cache the Prisma client in development (avoiding hot-reload connection leaks), and creates a new instance in production (where each serverless invocation gets its own module scope). No `$disconnect()` calls in user code (verified). Neon handles connection pooling via PgBouncer.

---

### Finding 5.2 -- No Connection Pool or Timeout Configuration

- **Severity:** LOW
- **Location:** `prisma/schema.prisma:6-10`
- **Description:** No explicit connection pool size or statement timeout configured. Prisma defaults to `connection_limit=5`. Long-running queries (e.g., the unbounded sales/trends route at scale) could hold connections indefinitely.
- **Fix:** Consider adding `?connection_limit=10&statement_timeout=30000` to the DATABASE_URL for safety.

---

## 6. DATA INTEGRITY

### Finding 6.1 -- Import Route: Lot Updates + Salessheet Recalculation Not Transactional

- **Severity:** MEDIUM
- **Location:** `src/app/api/import/orders/route.ts:366-436`, `src/app/api/import/costs/route.ts:228-280`
- **Description:** The lot aggregate recalculation (totalStems, avgPrice, totalAmount) and salessheet total recalculation (totalTurnover, totalCosts, netResult) are done via raw SQL CTEs after the transaction inserts, but they are NOT in a database transaction together. If the function crashes between phases, data will be inconsistent until the next import.
- **Current behavior:** Works in practice because re-imports are idempotent (ON CONFLICT patterns).
- **Fix:** Either wrap in `prisma.$transaction()` or accept the risk given idempotent re-imports.

---

### Finding 6.2 -- Decimal Arithmetic in JavaScript

- **Severity:** LOW
- **Location:** `src/app/api/fust/grower-invoices/route.ts:209-212`
- **Description:** VAT calculation uses JavaScript floating point: `Math.round(subtotalExVat * (vatRate / 100) * 100) / 100`. The `Math.round` pattern mitigates precision issues, but accumulated floating-point errors from `qty * unitPrice` multiplications could cause 1-cent discrepancies on large invoices.
- **Fix:** Use a decimal library or perform the calculation in SQL where NUMERIC types handle precision natively.

---

### Finding 6.3 -- Cascade Delete on Supplier Relations

- **Severity:** LOW
- **Location:** `prisma/schema.prisma` -- Lot, SalesSheet, Document, QualityIssue, etc.
- **Description:** `onDelete: Cascade` is set on Supplier relations for Lot, SalesSheet, Document, QualityIssue, Certificate, ChangeRequest. Deleting a Supplier would cascade-delete ALL their data. No supplier delete API exists, so this is safe, but it is worth noting.

---

## 7. POSITIVE OBSERVATIONS

### 7.1 -- Import Routes: Excellent Bulk Pattern
The import routes (lots, orders, costs, suppliers) use an exemplary pattern: pre-fetch all existing data in parallel, split into creates/updates, execute via raw SQL `INSERT ... ON CONFLICT` and `UPDATE ... FROM jsonb_array_elements`. This handles thousands of records efficiently in 3-5 queries regardless of batch size.

### 7.2 -- Dashboard: Good Use of Promise.all
The dashboard route parallelizes 8 aggregate queries using `Promise.all`, minimizing wall-clock time. This is well done.

### 7.3 -- Grower Invoice Creation: Properly Transactional
Invoice creation + marking orders as invoiced is properly wrapped in `prisma.$transaction()`. PDF and XML are generated BEFORE the transaction, so failures don't leave orphaned data.

### 7.4 -- Audit Log: Fire-and-Forget Pattern
Audit logging uses try/catch with `console.error` to avoid blocking the main operation. This is a reasonable trade-off for non-critical audit data.

### 7.5 -- Schema: Good Foreign Key Index Coverage
Almost all foreign keys have corresponding indexes. The schema demonstrates awareness of query patterns with compound indexes like `@@index([supplierId, productName])` and `@@index([supplierId, date])` on QualityIssue.

---

## 8. PRIORITIZED ACTION PLAN

### Immediate (High Impact, Before Next Data Growth)

| # | Finding | Effort | Impact |
|---|---------|--------|--------|
| 1 | Fix dashboard chart year view N+1 (1.1) | 1h | Eliminates 24 queries -> 2 |
| 2 | Fix sales daily breakdown unbounded fetch (2.1) | 2h | Prevents OOM at scale |
| 3 | Fix sales trends unbounded fetch (2.2) | 2h | Prevents OOM at scale |
| 4 | Add index: Supplier.accountManagerCode (3.6) | 5min | Every commercie request |
| 5 | Add index: Transaction(lotId, date) (3.1) | 5min | Most common query pattern |

### Short-term (Before 10x Scale)

| # | Finding | Effort | Impact |
|---|---------|--------|--------|
| 6 | Fix forecast upsert N+1 (1.5) | 1h | 120 queries -> 1 for copy |
| 7 | Fix grower import N+1 (1.6) | 30min | Consistent with other imports |
| 8 | Fix fust pickup N+1s (1.2, 1.3) | 1h | Batch operations |
| 9 | Add pagination to fust endpoints (2.4-2.8) | 2h | Prevents unbounded growth |
| 10 | Add remaining indexes (3.2-3.5) | 5min | Minor improvements |

### Nice-to-have

| # | Finding | Effort | Impact |
|---|---------|--------|--------|
| 11 | SQL JOINs for groupBy+re-fetch patterns (4.1) | 2h | 2 queries -> 1 per endpoint |
| 12 | Add statement_timeout to DB URL (5.2) | 5min | Safety net |
| 13 | Wrap imports in transactions (6.1) | 1h | Consistency guarantee |

---

## SCHEMA INDEX ADDITIONS (Copy-Paste Ready)

Add these to `prisma/schema.prisma`:

```prisma
// In Transaction model (after existing @@index directives):
@@index([lotId, date])
@@index([createdAt])

// In Lot model (after existing @@index directives):
@@index([createdAt])

// In Supplier model (after existing @@index directives):
@@index([accountManagerCode])

// In FustIssuanceVoucherItem model:
@@index([voucherId])

// In FustInvoiceItem model:
@@index([invoiceId])
```

Then run `npx prisma db push` for each environment (test + production).
