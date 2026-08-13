# LotCorrection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store Fabric lot corrections (volume adjustments) in a separate `LotCorrection` table, aggregate `correctionVolume` on Lot, display corrections on the lot detail page, and update all DAX queries to include the `Facttype Sub` column.

**Architecture:** Fabric sends multiple rows per `part_id`: `origineel`/`productie` rows are the base lot, `correctie`/`productiecorrectie` rows are volume corrections. The import endpoint splits incoming rows by `Facttype Sub`, creates/updates Lots from base rows, and upserts LotCorrections from correction rows. The Lot's `correctionVolume` is the sum of all its corrections. The frontend shows a collapsible corrections section on the lot detail page.

**Tech Stack:** Prisma 6, PostgreSQL (Neon), Next.js App Router API routes, React, Tailwind/shadcn, DAX (Power BI)

---

## File Structure

| File | Role |
|------|------|
| `prisma/schema.prisma` | Add `LotCorrection` model, modify `Lot` model |
| `src/app/api/import/lots/route.ts` | Refactor: split rows by `Facttype Sub`, handle corrections |
| `src/app/(portal)/lots/[id]/page.tsx` | Include corrections in Prisma query |
| `src/app/(portal)/lots/[id]/lot-detail.tsx` | Add corrections section |
| `src/i18n/en.json` | Add correction translation keys |
| `src/i18n/nl.json` | Add correction translation keys |
| `scripts/backfill.ts` | Add `Facttype Sub` field to `transformPartij` |
| `private_input/PBI/Partij_extract.dax` | Add `Facttype Sub` column |
| `private_input/PBI/Partij_backfill_2025.dax` | Add `Facttype Sub` column |
| `private_input/PBI/Partij_backfill_2026.dax` | Add `Facttype Sub` column |

---

### Task 1: Prisma Schema — Add LotCorrection Model

**Files:**
- Modify: `prisma/schema.prisma:198-250`

- [ ] **Step 1: Add `LotCorrection` model and update `Lot` model**

In `prisma/schema.prisma`, after the `Lot` model's `qualityIssues` relation (line 238), add a `corrections` relation. Remove `correctionReasonId` from the `Lot` model (line 230) since it belongs on individual corrections. Keep `correctionVolume` on `Lot` as the aggregate field.

Add the new model after the Lot model block (after line 250):

```prisma
// ─── LOT CORRECTIONS (PARTIJCORRECTIES) ────────────────────

model LotCorrection {
  id                 String   @id @default(uuid())
  lotId              String
  lot                Lot      @relation(fields: [lotId], references: [id], onDelete: Cascade)
  fabricPartId       Int?     // part_id of the correction row (unique in Fabric)
  facttypeSub        String   // "correctie" or "productiecorrectie"
  correctionReasonId Int?     // reden_id_correctie from Fabric
  correctionVolume   Int?     // Inslagcorrectie volume (this individual correction)
  correctionColli    Int?     // Inslag colli correctie (this individual correction)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @default(now()) @updatedAt

  @@unique([lotId, fabricPartId])
  @@index([lotId])
  @@index([fabricPartId])
}
```

In the `Lot` model, make these changes:
1. Remove line 230: `correctionReasonId Int?   // reden_id_correctie from Fabric`
2. Add after `qualityIssues  QualityIssue[]` (line 238): `corrections    LotCorrection[]`

The `Lot` model's correction section should now look like:

```prisma
  // Correction fields
  invoicedColli      Int?   // Inkoopfactuur colli
  invoicedVolume     Int?   // Inkoopfactuur volume
  correctionVolume   Int?   // Aggregate: sum of all LotCorrection.correctionVolume
```

- [ ] **Step 2: Push schema to test database**

```bash
npx prisma db push
```

Expected: Schema updated successfully. New `LotCorrection` table created, `correctionReasonId` column removed from `Lot`.

- [ ] **Step 3: Generate Prisma client**

Stop dev server if running, then:

```bash
npx prisma generate
```

Expected: Prisma client generated with new `LotCorrection` model.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add LotCorrection model for Fabric correction rows"
```

---

### Task 2: Update DAX Queries — Add Facttype Sub Column

**Files:**
- Modify: `private_input/PBI/Partij_extract.dax`
- Modify: `private_input/PBI/Partij_backfill_2025.dax`
- Modify: `private_input/PBI/Partij_backfill_2026.dax`

- [ ] **Step 1: Update `Partij_extract.dax`**

Add `"Facttype Sub"` column. Insert after the `"Inslagcorrectie volume"` line (line 25). Also remove the `Inkooptype Code = "CONS"` filter since corrections and productie rows may have different inkooptypes. Replace the filter with a check that excludes non-consignment base types (keep all correction rows):

Replace the contents of `Partij_extract.dax` with:

```dax
EVALUATE
    SELECTCOLUMNS(
        FILTER(
            'Fact_Partij',
            'Fact_Partij'[Lever Datum/Tijd] >= TODAY() - 2
                && 'Fact_Partij'[Lever Datum/Tijd] < TODAY() + 1
                && 'Fact_Partij'[Inkooptype Code] = "CONS"
        ),
        "Inkoop Factuur Nummer", 'Fact_Partij'[Inkoop Factuur Nummer],
        "Partijnummer", 'Fact_Partij'[Partijnummer],
        "Lever Datum/Tijd", 'Fact_Partij'[Lever Datum/Tijd],
        "Artikel Naam", RELATED('Dim_Artikel'[Artikel Naam]),
        "Artikel Code", RELATED('Dim_Artikel'[Artikel Code]),
        "Inkooptype Code", 'Fact_Partij'[Inkooptype Code],
        "S01", 'Fact_Partij'[S01],
        "S02", 'Fact_Partij'[S02],
        "S03", 'Fact_Partij'[S03],
        "part_id", 'Fact_Partij'[part_id],
        "parthdr_id", 'Fact_Partij'[parthdr_id],
        "rel_id_leverancier", 'Fact_Partij'[rel_id_leverancier],
        "art_id", 'Fact_Partij'[art_id],
        "reden_id_correctie", 'Fact_Partij'[reden_id_correctie],
        "Inkoopfactuur colli", CALCULATE([Inkoopfactuur colli]),
        "Inkoopfactuur volume", CALCULATE([Inkoopfactuur volume]),
        "Inslagcorrectie volume", CALCULATE([Inslagcorrectie volume]),
        "Facttype Sub", 'Fact_Partij'[Facttype Sub]
    )
ORDER BY [Inkoop Factuur Nummer] DESC, [Lever Datum/Tijd] DESC
```

- [ ] **Step 2: Update `Partij_backfill_2025.dax`**

Same change — add `"Facttype Sub"` column at the end of the SELECTCOLUMNS:

```dax
EVALUATE
    SELECTCOLUMNS(
        FILTER(
            'Fact_Partij',
            'Fact_Partij'[Lever Datum/Tijd] >= DATE(2025, 1, 1)
                && 'Fact_Partij'[Lever Datum/Tijd] < DATE(2026, 1, 1)
                && 'Fact_Partij'[Inkooptype Code] = "CONS"
        ),
        "Inkoop Factuur Nummer", 'Fact_Partij'[Inkoop Factuur Nummer],
        "Partijnummer", 'Fact_Partij'[Partijnummer],
        "Lever Datum/Tijd", 'Fact_Partij'[Lever Datum/Tijd],
        "Artikel Naam", RELATED('Dim_Artikel'[Artikel Naam]),
        "Artikel Code", RELATED('Dim_Artikel'[Artikel Code]),
        "Inkooptype Code", 'Fact_Partij'[Inkooptype Code],
        "S01", 'Fact_Partij'[S01],
        "S02", 'Fact_Partij'[S02],
        "S03", 'Fact_Partij'[S03],
        "part_id", 'Fact_Partij'[part_id],
        "parthdr_id", 'Fact_Partij'[parthdr_id],
        "rel_id_leverancier", 'Fact_Partij'[rel_id_leverancier],
        "art_id", 'Fact_Partij'[art_id],
        "reden_id_correctie", 'Fact_Partij'[reden_id_correctie],
        "Inkoopfactuur colli", CALCULATE([Inkoopfactuur colli]),
        "Inkoopfactuur volume", CALCULATE([Inkoopfactuur volume]),
        "Inslagcorrectie volume", CALCULATE([Inslagcorrectie volume]),
        "Facttype Sub", 'Fact_Partij'[Facttype Sub]
    )
ORDER BY [Lever Datum/Tijd] DESC
```

- [ ] **Step 3: Update `Partij_backfill_2026.dax`**

Same change — add `"Facttype Sub"` column:

```dax
EVALUATE
    SELECTCOLUMNS(
        FILTER(
            'Fact_Partij',
            'Fact_Partij'[Lever Datum/Tijd] >= DATE(2026, 1, 1)
                && 'Fact_Partij'[Lever Datum/Tijd] < TODAY()
                && 'Fact_Partij'[Inkooptype Code] = "CONS"
        ),
        "Inkoop Factuur Nummer", 'Fact_Partij'[Inkoop Factuur Nummer],
        "Partijnummer", 'Fact_Partij'[Partijnummer],
        "Lever Datum/Tijd", 'Fact_Partij'[Lever Datum/Tijd],
        "Artikel Naam", RELATED('Dim_Artikel'[Artikel Naam]),
        "Artikel Code", RELATED('Dim_Artikel'[Artikel Code]),
        "Inkooptype Code", 'Fact_Partij'[Inkooptype Code],
        "S01", 'Fact_Partij'[S01],
        "S02", 'Fact_Partij'[S02],
        "S03", 'Fact_Partij'[S03],
        "part_id", 'Fact_Partij'[part_id],
        "parthdr_id", 'Fact_Partij'[parthdr_id],
        "rel_id_leverancier", 'Fact_Partij'[rel_id_leverancier],
        "art_id", 'Fact_Partij'[art_id],
        "reden_id_correctie", 'Fact_Partij'[reden_id_correctie],
        "Inkoopfactuur colli", CALCULATE([Inkoopfactuur colli]),
        "Inkoopfactuur volume", CALCULATE([Inkoopfactuur volume]),
        "Inslagcorrectie volume", CALCULATE([Inslagcorrectie volume]),
        "Facttype Sub", 'Fact_Partij'[Facttype Sub]
    )
ORDER BY [Lever Datum/Tijd] DESC
```

- [ ] **Step 4: Commit**

```bash
git add private_input/PBI/Partij_extract.dax private_input/PBI/Partij_backfill_2025.dax private_input/PBI/Partij_backfill_2026.dax
git commit -m "feat: add Facttype Sub column to all partij DAX queries"
```

---

### Task 3: Update Import API — Split Origineel/Correctie Rows

**Files:**
- Modify: `src/app/api/import/lots/route.ts`

This is the largest task. The endpoint must:
1. Accept a new optional `Facttype Sub` field
2. Split rows: `origineel`/`productie` (or missing/empty) → Lot, `correctie`/`productiecorrectie` → LotCorrection
3. For correction rows: find the parent Lot by `Partijnummer + rel_id_leverancier` (same lot number, same supplier), then upsert a LotCorrection
4. After all corrections are processed, update the Lot's aggregate `correctionVolume`

- [ ] **Step 1: Update Zod schema to accept `Facttype Sub`**

Add to `partijSchema` (after `"Inslagcorrectie volume"`, line 23):

```typescript
  "Facttype Sub": z.string().nullable().optional(),
```

- [ ] **Step 2: Add helper to classify rows**

After the `deriveArticleGroup` function (line 33), add:

```typescript
/** Classify a Facttype Sub value into base lot or correction */
function isCorrection(facttypeSub: string | null | undefined): boolean {
  if (!facttypeSub) return false;
  const lower = facttypeSub.toLowerCase().trim();
  return lower === "correctie" || lower === "productiecorrectie";
}
```

- [ ] **Step 3: Split rows in the main processing logic**

After the existing `for (const row of partijen)` loop that rounds IDs (line 87-93), add the row splitting logic:

```typescript
    // Split rows by Facttype Sub: base rows vs correction rows
    const baseRows = partijen.filter((r) => !isCorrection(r["Facttype Sub"]));
    const correctionRows = partijen.filter((r) => isCorrection(r["Facttype Sub"]));
```

Then change all subsequent processing to use `baseRows` instead of `partijen`:
- Line 96: `for (const row of baseRows)` (was `partijen`)
- Line 103: `const allPartIds = baseRows.map(...)` (was `partijen`)
- Phase 2-6: all references to `partijen` should become `baseRows` except for `partijen.length` which stays for the `received` count in the response

- [ ] **Step 4: Remove `correctionReasonId` from lot create/update data**

In the lot update data (around line 319), remove:
```typescript
            correctionReasonId: row.reden_id_correctie || null,
```

In the lot create data (around line 348), remove:
```typescript
            correctionReasonId: row.reden_id_correctie || null,
```

In the raw SQL UPDATE statement (around line 385), remove:
```sql
           "correctionReasonId" = (u.val->>'correctionReasonId')::int,
```

In the raw SQL INSERT statement (around lines 438-489), remove `"correctionReasonId"` from both the column list and the VALUES/SELECT and the ON CONFLICT DO UPDATE SET.

- [ ] **Step 5: Add Phase 7 — Process correction rows and update aggregate**

After Phase 6 (lot operations, around line 500), add a new phase that:
1. Groups correction rows by `Partijnummer + rel_id_leverancier`
2. For each group, finds the parent Lot (by lotNumber + supplierId via the supplierMap)
3. Bulk upserts LotCorrection records
4. Updates Lot.correctionVolume as the sum of all its corrections

```typescript
    // Phase 7: Process correction rows → LotCorrection records
    let correctionsCreated = 0;
    let correctionsUpdated = 0;
    let correctionsSkipped = 0;

    if (correctionRows.length > 0) {
      // Find parent lots for correction rows by lotNumber + supplier
      const corrLotNumbers = [...new Set(correctionRows.map((r) => String(r.Partijnummer).trim()))];
      const corrSupplierFabricIds = [...new Set(correctionRows.map((r) => r.rel_id_leverancier))];
      const corrSupplierIds = corrSupplierFabricIds
        .map((fid) => supplierMap.get(fid))
        .filter(Boolean) as string[];

      const parentLots = await prisma.lot.findMany({
        where: {
          lotNumber: { in: corrLotNumbers },
          supplierId: { in: corrSupplierIds },
        },
        select: { id: true, lotNumber: true, supplierId: true },
      });

      // Build lookup: "lotNumber::supplierId" → lot.id
      const lotLookup = new Map<string, string>();
      for (const lot of parentLots) {
        lotLookup.set(`${lot.lotNumber}::${lot.supplierId}`, lot.id);
      }

      // Also check which corrections already exist
      const corrFabricPartIds = correctionRows.map((r) => r.part_id);
      const existingCorrections = await prisma.lotCorrection.findMany({
        where: { fabricPartId: { in: corrFabricPartIds } },
        select: { fabricPartId: true },
      });
      const existingCorrSet = new Set(existingCorrections.map((c) => c.fabricPartId));

      // Deduplicate correction rows by fabricPartId (part_id)
      const corrDedupMap = new Map<number, (typeof correctionRows)[0]>();
      for (const row of correctionRows) {
        corrDedupMap.set(row.part_id, row);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const corrCreateData: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const corrUpdateData: any[] = [];

      for (const row of corrDedupMap.values()) {
        const lotNumber = String(row.Partijnummer).trim();
        const supplierId = supplierMap.get(row.rel_id_leverancier);
        if (!supplierId) {
          correctionsSkipped++;
          continue;
        }

        const lotId = lotLookup.get(`${lotNumber}::${supplierId}`);
        if (!lotId) {
          correctionsSkipped++;
          continue;
        }

        const corrData = {
          lotId,
          fabricPartId: row.part_id,
          facttypeSub: row["Facttype Sub"]?.toLowerCase().trim() || "correctie",
          correctionReasonId: row.reden_id_correctie || null,
          correctionVolume: row["Inslagcorrectie volume"] ?? null,
          correctionColli: row["Inkoopfactuur colli"] ?? null,
        };

        if (existingCorrSet.has(row.part_id)) {
          corrUpdateData.push(corrData);
          correctionsUpdated++;
        } else {
          corrCreateData.push(corrData);
          correctionsCreated++;
        }
      }

      // Bulk insert new corrections
      if (corrCreateData.length > 0) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "LotCorrection" (
             id, "lotId", "fabricPartId", "facttypeSub",
             "correctionReasonId", "correctionVolume", "correctionColli",
             "createdAt", "updatedAt"
           )
           SELECT
             gen_random_uuid()::text,
             v.val->>'lotId',
             (v.val->>'fabricPartId')::int,
             v.val->>'facttypeSub',
             (v.val->>'correctionReasonId')::int,
             (v.val->>'correctionVolume')::int,
             (v.val->>'correctionColli')::int,
             NOW(),
             NOW()
           FROM jsonb_array_elements($1::jsonb) AS v(val)
           ON CONFLICT ("lotId", "fabricPartId") DO UPDATE SET
             "facttypeSub" = EXCLUDED."facttypeSub",
             "correctionReasonId" = EXCLUDED."correctionReasonId",
             "correctionVolume" = EXCLUDED."correctionVolume",
             "correctionColli" = EXCLUDED."correctionColli",
             "updatedAt" = NOW()`,
          JSON.stringify(corrCreateData)
        );
      }

      // Bulk update existing corrections
      if (corrUpdateData.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "LotCorrection" AS t
           SET
             "facttypeSub" = u.val->>'facttypeSub',
             "correctionReasonId" = (u.val->>'correctionReasonId')::int,
             "correctionVolume" = (u.val->>'correctionVolume')::int,
             "correctionColli" = (u.val->>'correctionColli')::int,
             "updatedAt" = NOW()
           FROM jsonb_array_elements($1::jsonb) AS u(val)
           WHERE t."fabricPartId" = (u.val->>'fabricPartId')::int`,
          JSON.stringify(corrUpdateData)
        );
      }

      // Update aggregate correctionVolume on parent lots
      const affectedLotIds = [...new Set([
        ...corrCreateData.map((d: { lotId: string }) => d.lotId),
        ...corrUpdateData.map((d: { lotId: string }) => d.lotId),
      ])];

      if (affectedLotIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Lot" AS l
           SET "correctionVolume" = sub.total_vol,
               "updatedAt" = NOW()
           FROM (
             SELECT "lotId", SUM("correctionVolume") AS total_vol
             FROM "LotCorrection"
             WHERE "lotId" = ANY($1::text[])
             GROUP BY "lotId"
           ) AS sub
           WHERE l.id = sub."lotId"`,
          affectedLotIds
        );
      }
    }
```

- [ ] **Step 6: Update response JSON to include correction counts**

Change the response (around line 525) to:

```typescript
    return NextResponse.json({
      received: partijen.length,
      salesSheets: { created: ssCreated, updated: ssUpdated },
      lots: { created: lotCreated, updated: lotUpdated },
      corrections: { created: correctionsCreated, updated: correctionsUpdated, skipped: correctionsSkipped },
      skipped,
    });
```

Also update the ImportBatch details similarly.

- [ ] **Step 7: Verify the endpoint compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/import/lots/route.ts
git commit -m "feat: split import lots by Facttype Sub, create LotCorrection records"
```

---

### Task 4: Update Backfill Script

**Files:**
- Modify: `scripts/backfill.ts`

- [ ] **Step 1: Add `Facttype Sub` to `transformPartij` function**

In `scripts/backfill.ts`, add to the `transformPartij` function (after `"Inslagcorrectie volume"`, line 103):

```typescript
    "Facttype Sub": parseStr(row["Facttype Sub"]),
```

- [ ] **Step 2: Commit**

```bash
git add scripts/backfill.ts
git commit -m "feat: add Facttype Sub field to backfill partij transformer"
```

---

### Task 5: Frontend — Add Corrections to Lot Detail

**Files:**
- Modify: `src/app/(portal)/lots/[id]/page.tsx`
- Modify: `src/app/(portal)/lots/[id]/lot-detail.tsx`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/nl.json`

- [ ] **Step 1: Add translation keys**

In `src/i18n/en.json`, add to the `"lots"` section (after `"containerType": "Container"`, line 164):

```json
    "corrections": "Corrections",
    "correctionVolume": "Volume",
    "correctionColli": "Colli",
    "correctionReason": "Reason ID",
    "correctionType": "Type",
    "noCorrections": "No corrections",
    "totalCorrectionVolume": "Total Correction Volume"
```

In `src/i18n/nl.json`, add to the `"lots"` section (after `"containerType": "Verpakking"`, line 164):

```json
    "corrections": "Correcties",
    "correctionVolume": "Volume",
    "correctionColli": "Colli",
    "correctionReason": "Reden ID",
    "correctionType": "Type",
    "noCorrections": "Geen correcties",
    "totalCorrectionVolume": "Totaal Correctie Volume"
```

- [ ] **Step 2: Update server component to include corrections**

In `src/app/(portal)/lots/[id]/page.tsx`, add `corrections` to the Prisma `include` (after `qualityIssues: true`, line 19):

```typescript
      corrections: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          facttypeSub: true,
          correctionReasonId: true,
          correctionVolume: true,
          correctionColli: true,
        },
      },
```

- [ ] **Step 3: Update LotDetailProps interface**

In `src/app/(portal)/lots/[id]/lot-detail.tsx`, add to the `LotDetailProps` interface (after `qualityIssues`, line 63):

```typescript
    corrections: {
      id: string;
      facttypeSub: string;
      correctionReasonId: number | null;
      correctionVolume: number | null;
      correctionColli: number | null;
    }[];
```

Also add to the lot interface (e.g. after `status: string;`, line 39):

```typescript
    correctionVolume: number | null;
```

- [ ] **Step 4: Add corrections section to the component**

In `src/app/(portal)/lots/[id]/lot-detail.tsx`, add a corrections section after the Quality Issues card (after the closing `)}` of the quality issues conditional, around line 224). Add it before the closing `</div>` of `page-content`:

```tsx
      {/* Corrections */}
      {lot.corrections.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("lots.corrections")}</CardTitle>
              {lot.correctionVolume != null && (
                <span className="text-sm text-muted-foreground">
                  {t("lots.totalCorrectionVolume")}: {formatNumber(lot.correctionVolume)}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("lots.correctionType")}</TableHead>
                  <TableHead>{t("lots.correctionReason")}</TableHead>
                  <TableHead className="text-right">{t("lots.correctionVolume")}</TableHead>
                  <TableHead className="text-right">{t("lots.correctionColli")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lot.corrections.map((corr) => (
                  <TableRow key={corr.id}>
                    <TableCell>
                      <Badge variant="outline">
                        {corr.facttypeSub}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {corr.correctionReasonId ?? "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {corr.correctionVolume != null ? formatNumber(corr.correctionVolume) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {corr.correctionColli != null ? formatNumber(corr.correctionColli) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 5: Verify build**

```bash
npx tsc --noEmit && npm run build
```

Expected: No type errors, successful build.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/lots src/app/"(portal)"/lots src/i18n/en.json src/i18n/nl.json
git commit -m "feat: display lot corrections on detail page"
```

---

### Task 6: Verification

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: Successful build.

- [ ] **Step 3: Test with backfill dry run**

If backfill CSVs have been re-exported with `Facttype Sub` column:

```bash
npx tsx scripts/backfill.ts --dry-run --only lots
```

Expected: Sample record shows `"Facttype Sub"` field.

- [ ] **Step 4: Deploy and test**

Push to `develop` and verify on test:
1. Import endpoint accepts rows with `Facttype Sub`
2. Correction rows create `LotCorrection` records
3. Lot detail page shows corrections section for lots that have corrections
4. Lots without corrections show no corrections section

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: corrections feature adjustments"
```

---

## Notes

- **Backward compatibility**: The `Facttype Sub` field is optional in the Zod schema. Old data without this field will treat all rows as base lots (no corrections extracted). This ensures existing Power Automate flows keep working until updated.
- **Correction reason names**: Currently stored as numeric IDs (`correctionReasonId`). A dimension table (`Dim_Reden`) from Fabric will be needed later to show human-readable names. For now, the ID is displayed as-is.
- **Productie handling**: `productie` → treated as `origineel` (base lot). `productiecorrectie` → treated as `correctie`. The `isCorrection()` helper handles this classification.
- **Aggregate `correctionVolume`**: Updated via a SQL subquery that sums all `LotCorrection.correctionVolume` for the affected lot. This runs after every batch of corrections.
- **Parent lot lookup**: Corrections are matched to lots by `Partijnummer + rel_id_leverancier` → `Lot.lotNumber + Lot.supplierId`. Corrections that can't find a parent lot are skipped (counted in `correctionsSkipped`).
