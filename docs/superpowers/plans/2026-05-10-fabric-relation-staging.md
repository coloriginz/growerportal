# FabricRelation Staging & Admin Activation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct supplier import with a FabricRelation staging table, add admin UI for selective supplier activation with company/brand selection, and auto-resolve grower names from staging data.

**Architecture:** The supplier import endpoint changes from upserting `Supplier` records to upserting `FabricRelation` staging records. A new admin tab on the suppliers page shows all staged relations with status indicators (Supplier/Grower/Has data/No data). Admins can activate relations as Supplier with company selection. The orders import auto-resolves grower names from FabricRelation.

**Tech Stack:** Next.js App Router, Prisma 6, PostgreSQL (Neon), Zod, shadcn/ui (Tabs, Table, Badge, Dialog, Select), useFetch hook, sonner toasts.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `prisma/schema.prisma` | Modify | Replace `StagingKbtLeverancier` with `FabricRelation` model |
| `src/app/api/import/suppliers/route.ts` | Rewrite | Upsert into `FabricRelation` instead of `Supplier` |
| `src/app/api/import/orders/route.ts` | Modify | Resolve grower names from `FabricRelation` during creation |
| `src/app/api/admin/fabric-relations/route.ts` | Create | GET: list relations with status; POST: activate as supplier |
| `src/app/(portal)/suppliers/page.tsx` | Modify | Add tab param support, wrap both tabs |
| `src/app/(portal)/suppliers/suppliers-content.tsx` | Modify | Wrap in Tabs, add "Fabric Relations" tab |
| `src/app/(portal)/suppliers/fabric-relations-tab.tsx` | Create | Fabric relations table with callout, filters, activation |
| `src/i18n/en.json` | Modify | Add `fabricRelations.*` translation keys |
| `src/i18n/nl.json` | Modify | Add `fabricRelations.*` translation keys |

---

### Task 1: Schema — Replace StagingKbtLeverancier with FabricRelation

**Files:**
- Modify: `prisma/schema.prisma` (lines 691-706)

The existing `StagingKbtLeverancier` model (lines 693-706) is unused. Replace it with `FabricRelation` — a persistent staging table that holds all Fabric relations and serves as the name-lookup source.

- [ ] **Step 1: Replace StagingKbtLeverancier with FabricRelation in schema**

In `prisma/schema.prisma`, replace lines 691-706:

```prisma
// ─── FABRIC RELATIONS (all Fabric relaties, staging) ──────

model FabricRelation {
  id                 String   @id @default(uuid())
  fabricId           Int      @unique  // rel_id from Fabric
  code               String             // e.g. "COLBFL"
  name               String             // e.g. "Bergflora Capetown"
  accountManagerName String?
  accountManagerCode String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @default(now()) @updatedAt

  @@index([code])
}
```

Key differences from `StagingKbtLeverancier`:
- `fabricId` is `@unique` (upsert key, one record per relation — not per import batch)
- No `importBatchId` (this is persistent, not per-batch staging)
- Has `updatedAt` for tracking when last synced

- [ ] **Step 2: Run prisma generate**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" success message

- [ ] **Step 3: Run prisma db push**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema"

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "refactor: replace StagingKbtLeverancier with FabricRelation model"
```

---

### Task 2: Rewrite supplier import to target FabricRelation

**Files:**
- Rewrite: `src/app/api/import/suppliers/route.ts`

The import endpoint keeps the same external API contract (same request/response format, same auth). Internally it changes from upserting `Supplier` to upserting `FabricRelation`.

- [ ] **Step 1: Rewrite the supplier import route**

Replace the full contents of `src/app/api/import/suppliers/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth } from "@/lib/import-auth";

const supplierSchema = z.object({
  Code: z.string().min(1),
  Naam: z.string().min(1),
  ID: z.number().int(),
  "AM Naam": z.string().nullable().optional(),
  "AM Code": z.string().nullable().optional(),
});

const bodySchema = z.object({
  suppliers: z.array(supplierSchema).min(1),
});

export async function POST(request: NextRequest) {
  const authError = requireImportAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  let batch: { id: string } | null = null;
  try {
    batch = await prisma.importBatch.create({
      data: { endpoint: "suppliers", status: "running" },
    });
  } catch {
    // Batch logging should not block the import
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    if (batch) {
      try {
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "error",
            errorMessage: JSON.stringify(parsed.error.flatten()),
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
          },
        });
      } catch {}
    }
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { suppliers } = parsed.data;
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const row of suppliers) {
      try {
        const existing = await prisma.fabricRelation.findUnique({
          where: { fabricId: row.ID },
        });

        if (existing) {
          await prisma.fabricRelation.update({
            where: { fabricId: row.ID },
            data: {
              code: row.Code,
              name: row.Naam,
              accountManagerName: row["AM Naam"] || null,
              accountManagerCode: row["AM Code"] || null,
            },
          });
          updated++;
        } else {
          await prisma.fabricRelation.create({
            data: {
              fabricId: row.ID,
              code: row.Code,
              name: row.Naam,
              accountManagerName: row["AM Naam"] || null,
              accountManagerCode: row["AM Code"] || null,
            },
          });
          created++;
        }
      } catch {
        errors++;
      }
    }

    // Also update names of existing Grower records that match
    const growersFilled = await prisma.$executeRaw`
      UPDATE "Grower" g
      SET name = fr.name
      FROM "FabricRelation" fr
      WHERE g."fabricId" = fr."fabricId"
        AND (g.name IS NULL OR g.name != fr.name)
    `;

    if (batch) {
      try {
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "success",
            recordsReceived: suppliers.length,
            recordsCreated: created,
            recordsUpdated: updated,
            recordsSkipped: errors,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
            details: { growerNamesFilled: growersFilled },
          },
        });
      } catch {}
    }

    return NextResponse.json({ received: suppliers.length, created, updated, errors });
  } catch (err) {
    if (batch) {
      try {
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "error",
            errorMessage: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
          },
        });
      } catch {}
    }
    throw err;
  }
}
```

Key changes from current:
- Upserts `FabricRelation` instead of `Supplier`
- No company creation (that happens during activation)
- Bonus: batch-updates `Grower.name` from `FabricRelation` for any growers that already exist
- Same external API contract (request body, response format)

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/import/suppliers/route.ts
git commit -m "refactor: supplier import targets FabricRelation staging table"
```

---

### Task 3: Resolve grower names from FabricRelation in orders import

**Files:**
- Modify: `src/app/api/import/orders/route.ts` (lines 84-111)

When the orders import creates a new `Grower` record, look up the name from `FabricRelation`.

- [ ] **Step 1: Add FabricRelation name lookup to grower creation**

In `src/app/api/import/orders/route.ts`, find the grower creation section (around line 84). After building `growerPairs`, add a bulk lookup of FabricRelation names. Then use the name when creating growers.

Before the `for (const [fabricKwekerId, supplierId] of growerPairs)` loop (line 97), add:

```typescript
    // Lookup grower names from FabricRelation staging
    const growerFabricIds = [...growerPairs.keys()];
    const fabricRelations = await prisma.fabricRelation.findMany({
      where: { fabricId: { in: growerFabricIds } },
      select: { fabricId: true, name: true },
    });
    const nameMap = new Map<number, string>();
    for (const fr of fabricRelations) {
      nameMap.set(fr.fabricId, fr.name);
    }
```

Then modify the grower creation (line 104) to include the name:

Change:
```typescript
          const grower = await prisma.grower.create({
            data: { fabricId: fabricKwekerId, supplierId },
          });
```

To:
```typescript
          const grower = await prisma.grower.create({
            data: {
              fabricId: fabricKwekerId,
              supplierId,
              name: nameMap.get(fabricKwekerId) || null,
            },
          });
```

Also update existing growers that have no name yet (after the existing check, line 99-101):

Change:
```typescript
      if (existing) {
        growerMap.set(fabricKwekerId, existing.id);
        growersExisting++;
```

To:
```typescript
      if (existing) {
        growerMap.set(fabricKwekerId, existing.id);
        // Fill name from FabricRelation if missing
        const frName = nameMap.get(fabricKwekerId);
        if (frName && existing.name !== frName) {
          await prisma.grower.update({
            where: { id: existing.id },
            data: { name: frName },
          });
        }
        growersExisting++;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/import/orders/route.ts
git commit -m "feat: resolve grower names from FabricRelation during orders import"
```

---

### Task 4: API endpoint for Fabric Relations management

**Files:**
- Create: `src/app/api/admin/fabric-relations/route.ts`

GET returns all FabricRelation records enriched with status (is it an active Supplier? a Grower? has lot/transaction data?). POST activates a FabricRelation as a new Supplier.

- [ ] **Step 1: Create the API route**

Create `src/app/api/admin/fabric-relations/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

export async function GET() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  // Fetch all fabric relations
  const relations = await prisma.fabricRelation.findMany({
    orderBy: { code: "asc" },
  });

  // Build lookup maps for status enrichment
  const allFabricIds = relations.map((r) => r.fabricId);

  // Which fabricIds are active Suppliers?
  const suppliers = await prisma.supplier.findMany({
    where: { fabricId: { in: allFabricIds } },
    select: { fabricId: true, id: true, code: true },
  });
  const supplierMap = new Map<number, { id: string; code: string }>();
  for (const s of suppliers) {
    if (s.fabricId) supplierMap.set(s.fabricId, { id: s.id, code: s.code });
  }

  // Which fabricIds are Growers?
  const growers = await prisma.grower.findMany({
    where: { fabricId: { in: allFabricIds } },
    select: { fabricId: true, id: true, supplierId: true, supplier: { select: { code: true, name: true } } },
  });
  const growerMap = new Map<number, { id: string; supplierCode: string; supplierName: string }>();
  for (const g of growers) {
    if (g.fabricId) growerMap.set(g.fabricId, {
      id: g.id,
      supplierCode: g.supplier.code,
      supplierName: g.supplier.name,
    });
  }

  // Which fabricIds have lot data (as supplier)?
  const lotsAsSupplier = await prisma.$queryRaw<{ fabricId: number; count: number }[]>`
    SELECT s."fabricId" as "fabricId", CAST(COUNT(l.id) AS INT) as count
    FROM "Supplier" s
    JOIN "Lot" l ON l."supplierId" = s.id
    WHERE s."fabricId" = ANY(${allFabricIds})
    GROUP BY s."fabricId"
  `;
  const lotCountMap = new Map<number, number>();
  for (const r of lotsAsSupplier) {
    lotCountMap.set(r.fabricId, r.count);
  }

  // Which fabricIds have transaction data (as grower)?
  const txAsGrower = await prisma.$queryRaw<{ fabricGrowerId: number; count: number }[]>`
    SELECT t."fabricGrowerId" as "fabricGrowerId", CAST(COUNT(t.id) AS INT) as count
    FROM "Transaction" t
    WHERE t."fabricGrowerId" = ANY(${allFabricIds})
    GROUP BY t."fabricGrowerId"
  `;
  const txCountMap = new Map<number, number>();
  for (const r of txAsGrower) {
    txCountMap.set(r.fabricGrowerId, r.count);
  }

  // Which fabricIds appear as rel_id_leverancier in lots but are NOT activated as Supplier?
  // (they have data but no Supplier record)
  const unactivatedWithData = await prisma.$queryRaw<{ fabricId: number; lotCount: number }[]>`
    SELECT l."fabricParthdrId" as "fabricId", 0 as "lotCount"
    FROM "Lot" l
    WHERE FALSE
  `;
  // Actually: check Lot.supplierId links — but lots only link to existing suppliers.
  // The "has data" flag really means: does this fabricId appear as rel_id_leverancier
  // in lot import data? We can approximate by checking if they have lots already.
  // For now, lotCountMap covers this for activated suppliers.
  // For unactivated suppliers: we detect via FabricRelation fabricIds that appear
  // in Transaction.fabricGrowerId (as grower) but not Supplier (as supplier).

  const enriched = relations.map((r) => {
    const supplier = supplierMap.get(r.fabricId);
    const grower = growerMap.get(r.fabricId);
    const lotCount = lotCountMap.get(r.fabricId) || 0;
    const txCount = txCountMap.get(r.fabricId) || 0;

    let status: "supplier" | "grower" | "has_data" | "no_data";
    if (supplier) {
      status = "supplier";
    } else if (grower) {
      status = "grower";
    } else if (lotCount > 0 || txCount > 0) {
      status = "has_data";
    } else {
      status = "no_data";
    }

    return {
      id: r.id,
      fabricId: r.fabricId,
      code: r.code,
      name: r.name,
      accountManagerName: r.accountManagerName,
      accountManagerCode: r.accountManagerCode,
      updatedAt: r.updatedAt,
      status,
      supplierId: supplier?.id || null,
      supplierCode: supplier?.code || null,
      growerInfo: grower ? {
        id: grower.id,
        supplierCode: grower.supplierCode,
        supplierName: grower.supplierName,
      } : null,
      lotCount,
      txCount,
    };
  });

  // Summary for callout
  const unactivated = enriched.filter((r) => r.status === "has_data");

  return NextResponse.json({
    relations: enriched,
    summary: {
      total: enriched.length,
      suppliers: enriched.filter((r) => r.status === "supplier").length,
      growers: enriched.filter((r) => r.status === "grower").length,
      hasData: unactivated.length,
      noData: enriched.filter((r) => r.status === "no_data").length,
    },
    unactivatedWithData: unactivated.map((r) => ({
      fabricId: r.fabricId,
      code: r.code,
      name: r.name,
    })),
  });
}

const activateSchema = z.object({
  fabricId: z.number().int(),
  companyId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const body = await request.json();
  const parsed = activateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { fabricId, companyId } = parsed.data;

  // Check FabricRelation exists
  const relation = await prisma.fabricRelation.findUnique({ where: { fabricId } });
  if (!relation) {
    return NextResponse.json({ error: "Fabric relation not found" }, { status: 404 });
  }

  // Check not already a Supplier
  const existing = await prisma.supplier.findFirst({ where: { fabricId } });
  if (existing) {
    return NextResponse.json({ error: "Already activated as supplier", supplierId: existing.id }, { status: 409 });
  }

  // Check company exists
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  // Create Supplier from FabricRelation data
  const supplier = await prisma.supplier.create({
    data: {
      code: relation.code,
      name: relation.name,
      fabricId: relation.fabricId,
      accountManagerName: relation.accountManagerName,
      accountManagerCode: relation.accountManagerCode,
      companyId: company.id,
    },
  });

  return NextResponse.json({
    supplierId: supplier.id,
    code: supplier.code,
    name: supplier.name,
  }, { status: 201 });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/fabric-relations/route.ts
git commit -m "feat: add admin API for fabric relations listing and supplier activation"
```

---

### Task 5: Translations

**Files:**
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/nl.json`

- [ ] **Step 1: Add English translations**

Add to `src/i18n/en.json` in the root object (after the existing `imports` block):

```json
"fabricRelations": {
  "title": "Fabric Relations",
  "description": "All relations from Fabric. Activate as supplier to give portal access.",
  "unactivatedWarning": "{{count}} relation(s) have data but are not activated as supplier",
  "activateAll": "Activate All",
  "activate": "Activate as Supplier",
  "selectCompany": "Select brand",
  "status": "Status",
  "supplier": "Supplier",
  "grower": "Grower",
  "hasData": "Has Data",
  "noData": "No Data",
  "lots": "Lots",
  "transactions": "Transactions",
  "accountManager": "Account Manager",
  "lastSynced": "Last Synced",
  "activateSuccess": "{{name}} activated as supplier",
  "filterStatus": "Filter by status",
  "all": "All",
  "growerUnder": "Grower under {{supplier}}"
}
```

- [ ] **Step 2: Add Dutch translations**

Add to `src/i18n/nl.json` the same block:

```json
"fabricRelations": {
  "title": "Fabric Relaties",
  "description": "Alle relaties uit Fabric. Activeer als leverancier voor portaltoegang.",
  "unactivatedWarning": "{{count}} relatie(s) hebben data maar zijn niet geactiveerd als leverancier",
  "activateAll": "Alles Activeren",
  "activate": "Activeer als Leverancier",
  "selectCompany": "Selecteer merk",
  "status": "Status",
  "supplier": "Leverancier",
  "grower": "Kweker",
  "hasData": "Heeft Data",
  "noData": "Geen Data",
  "lots": "Partijen",
  "transactions": "Transacties",
  "accountManager": "Accountmanager",
  "lastSynced": "Laatst Gesynchroniseerd",
  "activateSuccess": "{{name}} geactiveerd als leverancier",
  "filterStatus": "Filter op status",
  "all": "Alles",
  "growerUnder": "Kweker onder {{supplier}}"
}
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/en.json src/i18n/nl.json
git commit -m "feat: add translations for fabric relations management"
```

---

### Task 6: Fabric Relations tab component

**Files:**
- Create: `src/app/(portal)/suppliers/fabric-relations-tab.tsx`

This is the main UI component for the Fabric Relations tab. Shows a callout for unactivated relations with data, a filter bar, and a table with status badges and activation action.

- [ ] **Step 1: Create the fabric-relations-tab component**

Create `src/app/(portal)/suppliers/fabric-relations-tab.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  RiSearchLine, RiAlertLine, RiCheckLine, RiPlantLine, RiUserLine,
  RiDatabase2Line, RiLoader4Line,
} from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";

interface FabricRelationRow {
  id: string;
  fabricId: number;
  code: string;
  name: string;
  accountManagerName: string | null;
  accountManagerCode: string | null;
  updatedAt: string;
  status: "supplier" | "grower" | "has_data" | "no_data";
  supplierId: string | null;
  supplierCode: string | null;
  growerInfo: {
    id: string;
    supplierCode: string;
    supplierName: string;
  } | null;
  lotCount: number;
  txCount: number;
}

interface CompanyOption {
  id: string;
  name: string;
  slug: string;
}

interface ApiResponse {
  relations: FabricRelationRow[];
  summary: {
    total: number;
    suppliers: number;
    growers: number;
    hasData: number;
    noData: number;
  };
  unactivatedWithData: { fabricId: number; code: string; name: string }[];
}

export function FabricRelationsTab() {
  const { t } = useLanguage();
  const { data, loading, refetch } = useFetch<ApiResponse>("/api/admin/fabric-relations");
  const { data: companies } = useFetch<CompanyOption[]>("/api/companies");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activateDialog, setActivateDialog] = useState<FabricRelationRow | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [activating, setActivating] = useState(false);

  const relations = data?.relations || [];
  const summary = data?.summary;
  const unactivated = data?.unactivatedWithData || [];

  const filtered = relations.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.code.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      (r.accountManagerName && r.accountManagerName.toLowerCase().includes(q))
    );
  });

  async function handleActivate() {
    if (!activateDialog || !selectedCompanyId) return;
    setActivating(true);
    try {
      const res = await fetch("/api/admin/fabric-relations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fabricId: activateDialog.fabricId,
          companyId: selectedCompanyId,
        }),
      });
      if (res.ok) {
        toast.success(
          (t as unknown as (k: string) => string)("fabricRelations.activateSuccess")
            .replace("{{name}}", activateDialog.name)
        );
        setActivateDialog(null);
        setSelectedCompanyId("");
        refetch();
      } else {
        const err = await res.json();
        toast.error(err.error || "Activation failed");
      }
    } catch {
      toast.error("Activation failed");
    } finally {
      setActivating(false);
    }
  }

  function statusBadge(row: FabricRelationRow) {
    switch (row.status) {
      case "supplier":
        return <Badge variant="default">{(t as unknown as (k: string) => string)("fabricRelations.supplier")}</Badge>;
      case "grower":
        return (
          <Badge variant="secondary" className="max-w-[200px] truncate">
            {(t as unknown as (k: string) => string)("fabricRelations.growerUnder").replace("{{supplier}}", row.growerInfo?.supplierCode || "?")}
          </Badge>
        );
      case "has_data":
        return <Badge variant="outline" className="border-amber-500 text-amber-600">{(t as unknown as (k: string) => string)("fabricRelations.hasData")}</Badge>;
      case "no_data":
        return <Badge variant="outline" className="text-muted-foreground">{(t as unknown as (k: string) => string)("fabricRelations.noData")}</Badge>;
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RiLoader4Line className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Callout for unactivated relations with data */}
      {unactivated.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="flex items-start gap-3 py-3">
            <RiAlertLine className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {(t as unknown as (k: string) => string)("fabricRelations.unactivatedWarning").replace("{{count}}", String(unactivated.length))}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                {unactivated.map((u) => u.code).join(", ")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary badges */}
      {summary && (
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <span>{summary.total} total</span>
          <span>&middot;</span>
          <span className="text-green-600">{summary.suppliers} suppliers</span>
          <span>&middot;</span>
          <span className="text-blue-600">{summary.growers} growers</span>
          <span>&middot;</span>
          <span className="text-amber-600">{summary.hasData} with data</span>
          <span>&middot;</span>
          <span>{summary.noData} no data</span>
        </div>
      )}

      {/* Filter bar */}
      <div className="filter-bar">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearchLine className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search code, name, AM..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{(t as unknown as (k: string) => string)("fabricRelations.all")}</SelectItem>
            <SelectItem value="supplier">{(t as unknown as (k: string) => string)("fabricRelations.supplier")}</SelectItem>
            <SelectItem value="grower">{(t as unknown as (k: string) => string)("fabricRelations.grower")}</SelectItem>
            <SelectItem value="has_data">{(t as unknown as (k: string) => string)("fabricRelations.hasData")}</SelectItem>
            <SelectItem value="no_data">{(t as unknown as (k: string) => string)("fabricRelations.noData")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>{(t as unknown as (k: string) => string)("suppliers.name")}</TableHead>
                  <TableHead>{(t as unknown as (k: string) => string)("fabricRelations.accountManager")}</TableHead>
                  <TableHead>{(t as unknown as (k: string) => string)("fabricRelations.status")}</TableHead>
                  <TableHead className="text-right">{(t as unknown as (k: string) => string)("fabricRelations.lots")}</TableHead>
                  <TableHead className="text-right">{(t as unknown as (k: string) => string)("fabricRelations.transactions")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {row.accountManagerName || "-"}
                    </TableCell>
                    <TableCell>{statusBadge(row)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{row.lotCount || "-"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{row.txCount || "-"}</TableCell>
                    <TableCell className="text-right">
                      {row.status !== "supplier" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setActivateDialog(row); setSelectedCompanyId(""); }}
                        >
                          {(t as unknown as (k: string) => string)("fabricRelations.activate")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="py-0">
                      <div className="empty-state">
                        <div className="empty-state-icon"><RiDatabase2Line /></div>
                        <p className="empty-state-text">{(t as unknown as (k: string) => string)("common.noResults")}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Activation dialog */}
      <Dialog open={!!activateDialog} onOpenChange={(open) => { if (!open) setActivateDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {(t as unknown as (k: string) => string)("fabricRelations.activate")}
            </DialogTitle>
          </DialogHeader>
          {activateDialog && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted p-3 space-y-1">
                <p className="font-medium">{activateDialog.name}</p>
                <p className="text-sm text-muted-foreground">Code: {activateDialog.code} &middot; Fabric ID: {activateDialog.fabricId}</p>
                {activateDialog.accountManagerName && (
                  <p className="text-sm text-muted-foreground">AM: {activateDialog.accountManagerName}</p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {(t as unknown as (k: string) => string)("fabricRelations.selectCompany")} *
                </label>
                <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                  <SelectTrigger>
                    <SelectValue placeholder={(t as unknown as (k: string) => string)("fabricRelations.selectCompany")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(companies || []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleActivate}
                disabled={!selectedCompanyId || activating}
                className="w-full"
              >
                {activating ? (
                  <><RiLoader4Line className="mr-2 h-4 w-4 animate-spin" /> Activating...</>
                ) : (
                  <><RiCheckLine className="mr-2 h-4 w-4" /> {(t as unknown as (k: string) => string)("fabricRelations.activate")}</>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add "src/app/(portal)/suppliers/fabric-relations-tab.tsx"
git commit -m "feat: add FabricRelationsTab component with activation dialog"
```

---

### Task 7: Integrate Fabric Relations tab into Suppliers page

**Files:**
- Modify: `src/app/(portal)/suppliers/page.tsx`
- Modify: `src/app/(portal)/suppliers/suppliers-content.tsx`

Add a Tabs wrapper with two tabs: "Suppliers" (existing content) and "Fabric Relations" (new tab). Only admin sees the Fabric Relations tab.

- [ ] **Step 1: Update the suppliers page to pass session**

Replace `src/app/(portal)/suppliers/page.tsx`:

```typescript
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { SuppliersContent } from "./suppliers-content";

export default async function SuppliersPage() {
  const session = await auth();

  if (!session?.user || session.user.role === "supplier") {
    redirect("/dashboard");
  }

  return (
    <Suspense>
      <SuppliersContent isAdmin={session.user.role === "admin"} />
    </Suspense>
  );
}
```

- [ ] **Step 2: Add tabs to suppliers-content**

In `src/app/(portal)/suppliers/suppliers-content.tsx`, make these changes:

1. Add imports at the top:

```typescript
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FabricRelationsTab } from "./fabric-relations-tab";
```

2. Change the component signature to accept `isAdmin` prop:

```typescript
export function SuppliersContent({ isAdmin }: { isAdmin?: boolean }) {
```

3. Wrap the page content in Tabs. The return statement should wrap the existing content inside a TabsContent and add the Fabric Relations tab:

Find the return and the `<div className="page-content">` opening. Wrap the content:

```typescript
  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("suppliers.title")}</h1>
        {/* existing Dialog button stays here */}
      </div>

      {isAdmin ? (
        <Tabs defaultValue="suppliers">
          <TabsList>
            <TabsTrigger value="suppliers">{t("suppliers.title")}</TabsTrigger>
            <TabsTrigger value="fabric-relations">{t("fabricRelations.title")}</TabsTrigger>
          </TabsList>
          <TabsContent value="suppliers" className="mt-4">
            {/* Move existing search + table here */}
          </TabsContent>
          <TabsContent value="fabric-relations" className="mt-4">
            <FabricRelationsTab />
          </TabsContent>
        </Tabs>
      ) : (
        <>
          {/* Existing search + table for non-admin */}
        </>
      )}
    </div>
  );
```

The key is extracting the search bar + Card/Table into a fragment that can be used in both the tabbed and non-tabbed views. The simplest approach: extract to a local `suppliersTable` variable:

```typescript
  const suppliersTable = (
    <>
      {/* Search */}
      <div className="filter-bar">
        {/* ... existing search bar ... */}
      </div>
      {/* Table */}
      <Card>
        {/* ... existing table ... */}
      </Card>
    </>
  );

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("suppliers.title")}</h1>
        {/* existing Dialog stays */}
      </div>

      {isAdmin ? (
        <Tabs defaultValue="suppliers">
          <TabsList>
            <TabsTrigger value="suppliers">{t("suppliers.title")}</TabsTrigger>
            <TabsTrigger value="fabric-relations">{t("fabricRelations.title")}</TabsTrigger>
          </TabsList>
          <TabsContent value="suppliers" className="mt-4">
            {suppliersTable}
          </TabsContent>
          <TabsContent value="fabric-relations" className="mt-4">
            <FabricRelationsTab />
          </TabsContent>
        </Tabs>
      ) : (
        suppliersTable
      )}
    </div>
  );
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Verify build succeeds**

Run: `npm run build`
Expected: Successful build, no errors

- [ ] **Step 5: Commit**

```bash
git add "src/app/(portal)/suppliers/page.tsx" "src/app/(portal)/suppliers/suppliers-content.tsx"
git commit -m "feat: add Fabric Relations tab to suppliers page (admin only)"
```

---

### Task 8: Update import API documentation

**Files:**
- Modify: `docs/import-api.md`

- [ ] **Step 1: Update the docs to reflect the new behavior**

Add a note to the `POST /api/import/suppliers` section explaining that records now go to the `FabricRelation` staging table and must be activated by an admin to become portal Suppliers. Also mention the automatic Grower name resolution.

Add after the existing response section:

```markdown
### Behavior

Records are stored in the `FabricRelation` staging table (not directly as Supplier records). An admin must activate individual relations as Supplier via the portal UI (Suppliers > Fabric Relations tab). This allows selective onboarding of relevant suppliers.

Additionally, existing Grower records that match a FabricRelation by `fabricId` will have their `name` field updated automatically.
```

- [ ] **Step 2: Commit**

```bash
git add docs/import-api.md
git commit -m "docs: update import API docs for FabricRelation staging behavior"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npx tsc --noEmit` — no type errors
- [ ] `npm run build` — successful production build
- [ ] `npx prisma db push` — schema in sync
- [ ] Supplier import endpoint accepts same payload as before (API contract unchanged)
- [ ] FabricRelation records created in database after import
- [ ] Grower names populated from FabricRelation
- [ ] Admin sees "Fabric Relations" tab on Suppliers page
- [ ] Non-admin does NOT see the Fabric Relations tab
- [ ] Callout shows unactivated relations that have data
- [ ] "Activate as Supplier" creates a Supplier record with selected company
- [ ] Activated supplier appears in the regular Suppliers tab
- [ ] Status badges are correct: Supplier (green), Grower (blue), Has Data (amber), No Data (gray)
- [ ] Search and status filter work correctly
