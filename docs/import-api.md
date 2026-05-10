# Import API — Fabric → Grower Portal

## Overview

Four endpoints for automated data sync from Microsoft Fabric via Power Automate.
Designed to run **4x per day** with a **48-hour overlap window** — records are upserted (created or updated) based on Fabric IDs, so duplicate pushes are safe.

**Base URL:** `https://growerportal-test.vercel.app` (test) / `https://growerportal.vercel.app` (production)

**Call order:** Suppliers → Lots → Orders → Costs (dependencies flow left to right)

---

## Authentication

All endpoints require a Bearer token in the `Authorization` header.

```
Authorization: Bearer <IMPORT_API_KEY>
```

The key is configured as `IMPORT_API_KEY` in Vercel environment variables.

---

## 1. POST /api/import/suppliers

Upserts supplier (leverancier) records. Match key: `fabricId` (= `ID` from DAX).

**Push strategy:** Full set (all suppliers, not windowed). Small dataset (~660 records).

### Request body

```json
{
  "suppliers": [
    {
      "Code": "COLBFL",
      "Naam": "Bergflora Capetown (Pty) Ltd",
      "ID": 12345,
      "AM Naam": "Odilia van der Berg",
      "AM Code": "ODB"
    }
  ]
}
```

| Field | Type | Required | Maps to |
|-------|------|----------|---------|
| `Code` | string | yes | `Supplier.code` |
| `Naam` | string | yes | `Supplier.name` |
| `ID` | integer | yes | `Supplier.fabricId` (upsert key) |
| `AM Naam` | string | no | `Supplier.accountManagerName` |
| `AM Code` | string | no | `Supplier.accountManagerCode` |

### Response

```json
{
  "received": 660,
  "created": 2,
  "updated": 658,
  "errors": 0
}
```

### Behavior

Records are stored in the `FabricRelation` staging table (not directly as Supplier records). An admin must activate individual relations as Supplier via the portal UI (Suppliers > Fabric Relations tab). This allows selective onboarding of relevant suppliers.

Additionally, existing Grower records that match a FabricRelation by `fabricId` will have their `name` field updated automatically.

---

## 2. POST /api/import/lots

Upserts partijen (lots) and automatically creates/updates salessheets (leveringen) grouped by `parthdr_id`. Match keys: `fabricPartId` (lots), `fabricParthdrId` (salessheets).

**Push strategy:** 48-hour window on `Lever Datum/Tijd`.

### Request body

```json
{
  "partijen": [
    {
      "part_id": 567890,
      "parthdr_id": 45678,
      "rel_id_leverancier": 12345,
      "Partijnummer": "1234567",
      "Inkoop Factuur Nummer": "INV-2026-001",
      "Lever Datum/Tijd": "2026-05-08 00:00:00.000",
      "Artikel Naam": "Protea Cynaroides",
      "Artikel Code": "PRC001",
      "Inkooptype Code": "CONS",
      "S01": "60",
      "S02": "A1",
      "S03": null,
      "art_id": 789,
      "reden_id_correctie": null,
      "Inkoopfactuur colli": 10,
      "Inkoopfactuur volume": 500,
      "Inslagcorrectie volume": null
    }
  ]
}
```

| Field | Type | Required | Maps to |
|-------|------|----------|---------|
| `part_id` | integer | yes | `Lot.fabricPartId` (upsert key) |
| `parthdr_id` | integer | yes | `SalesSheet.fabricParthdrId` (upsert key) |
| `rel_id_leverancier` | integer | yes | Links lot → supplier via `Supplier.fabricId` |
| `Partijnummer` | string/number | yes | `Lot.lotNumber` |
| `Inkoop Factuur Nummer` | string | no | `SalesSheet.invoiceNumber` |
| `Lever Datum/Tijd` | string (datetime) | no | `SalesSheet.deliveryDate`, `Lot.deliveryDate` |
| `Artikel Naam` | string | no | `Lot.productName` |
| `Artikel Code` | string | no | `Lot.articleCode` |
| `Inkooptype Code` | string | no | `Lot.purchaseType` (CONS, FOB, CIF) |
| `S01` | string | no | `Lot.s1` (quality/stem length) |
| `S02` | string | no | `Lot.s2` (quality code) |
| `S03` | string | no | `Lot.s3` (quality code) |
| `art_id` | integer | no | `Lot.fabricArticleId` |
| `reden_id_correctie` | integer | no | `Lot.correctionReasonId` |
| `Inkoopfactuur colli` | integer | no | `Lot.invoicedColli`, `Lot.colli` |
| `Inkoopfactuur volume` | integer | no | `Lot.invoicedVolume`, `Lot.totalStems` |
| `Inslagcorrectie volume` | integer | no | `Lot.correctionVolume` |

### Response

```json
{
  "received": 250,
  "salesSheets": { "created": 5, "updated": 30 },
  "lots": { "created": 15, "updated": 235 },
  "skipped": 0
}
```

---

## 3. POST /api/import/orders

Upserts transactions (orderregels) and growers (kwekers). Automatically recalculates lot aggregates (totalStems, avgPrice, totalAmount) and salessheet totals. Match key: `fabricOrdregId`.

**Push strategy:** 48-hour window on `_datum_key_vertrek`.

### Request body

```json
{
  "orders": [
    {
      "ordreg_id": 9876543,
      "part_id": 567890,
      "parthdr_id": 45678,
      "rel_id_kweker": 11111,
      "rel_id_leverancier": 12345,
      "_datum_key_vertrek": "2026-05-08 00:00:00.000",
      "Verkooptype": "VMP",
      "Verkoopvolume": 100,
      "Verkoop_colli": 2,
      "Afrekenomzet": 42.39,
      "Gem afrekenprijs": 0.4239
    }
  ]
}
```

| Field | Type | Required | Maps to |
|-------|------|----------|---------|
| `ordreg_id` | integer | yes | `Transaction.fabricOrdregId` (upsert key) |
| `part_id` | integer | yes | Links transaction → lot via `Lot.fabricPartId` |
| `parthdr_id` | integer | yes | (context, not stored directly) |
| `rel_id_kweker` | integer | yes | `Grower.fabricId` (auto-created if new) |
| `rel_id_leverancier` | integer | yes | Links grower → supplier |
| `_datum_key_vertrek` | string (datetime) | yes | `Transaction.date` |
| `Verkooptype` | string | no | `Transaction.salesType` (VMP, Aurora, Veilen, Persoonlijk) |
| `Verkoopvolume` | integer | no | `Transaction.stems` |
| `Verkoop_colli` | integer | no | (not stored, informational) |
| `Afrekenomzet` | number | no | `Transaction.amount` |
| `Gem afrekenprijs` | number | no | `Transaction.pricePerStem` |

### Side effects

- Creates `Grower` records for new `rel_id_kweker` values
- Recalculates `Lot.totalStems`, `Lot.avgPrice`, `Lot.totalAmount` for affected lots
- Recalculates `SalesSheet.totalTurnover`, `SalesSheet.totalCosts`, `SalesSheet.netResult` for affected salessheets

### Response

```json
{
  "received": 1200,
  "growers": { "created": 1, "existing": 63 },
  "transactions": { "created": 50, "updated": 1140, "skipped": 10 },
  "recalculated": { "lots": 180, "salesSheets": 35 }
}
```

---

## 4. POST /api/import/costs

Upserts salessheet costs (kosten per levering). Recalculates salessheet totals. Match key: `fabricShkostId`.

**Push strategy:** 48-hour window, same as lots (linked via `Parthdr ID`).

### Request body

```json
{
  "costs": [
    {
      "Shkost ID": 111222,
      "Parthdr ID": 45678,
      "Kost Naam": "Commissie directe verkoop",
      "Kost ID": 50,
      "Kost Type Code": "VRK",
      "Kost Type Naam": "Verkoopkosten",
      "Totaal Omzet": 1234.56,
      "Totaal Aantal": 500,
      "Salesheet Amount": -61.73,
      "Laatste Ontvangstdatum": "2026-05-07 00:00:00.000",
      "Laatste Aanmelddatum": "2026-05-06 00:00:00.000"
    }
  ]
}
```

| Field | Type | Required | Maps to |
|-------|------|----------|---------|
| `Shkost ID` | integer | yes | `SalesSheetCost.fabricShkostId` (upsert key) |
| `Parthdr ID` | integer | yes | Links cost → salessheet via `SalesSheet.fabricParthdrId` |
| `Kost Naam` | string | no | `SalesSheetCost.description` |
| `Kost ID` | integer | no | `SalesSheetCost.fabricKostId` |
| `Kost Type Code` | string | no | `SalesSheetCost.costTypeCode` (VRK, VEI, INK, VWK) |
| `Kost Type Naam` | string | no | `SalesSheetCost.costTypeName` |
| `Totaal Omzet` | number | no | `SalesSheetCost.totalTurnover` |
| `Totaal Aantal` | integer | no | `SalesSheetCost.totalQuantity` |
| `Salesheet Amount` | number | yes | `SalesSheetCost.amount` |
| `Laatste Ontvangstdatum` | string (datetime) | no | `SalesSheet.lastReceiptDate` |
| `Laatste Aanmelddatum` | string (datetime) | no | `SalesSheet.lastRegistrationDate` |

### Side effects

- Recalculates `SalesSheet.totalTurnover`, `SalesSheet.totalCosts`, `SalesSheet.netResult`
- Updates `SalesSheet.lastReceiptDate` and `SalesSheet.lastRegistrationDate`

### Response

```json
{
  "received": 400,
  "created": 10,
  "updated": 385,
  "skipped": 5,
  "salesSheetsRecalculated": 30
}
```

---

## 5. POST /api/import/growers

Enriches existing Grower (kweker) records with name, code, country, and city from the Fabric `Dim_Kweker` dimension table. **Only updates growers that already exist** in the database (created via the orders import). Does not create new records.

**Push strategy:** Full set (all kwekers). Small dataset (~2700 records). Run after orders import.

### Request body

```json
{
  "growers": [
    {
      "Naam": "Bergflora Capetown (Pty) Ltd",
      "Code": "PCDEGREE",
      "ID": 18189,
      "Land Code": "ZA",
      "Land Naam": "Zuid Afrika",
      "Plaats": "Waboomskraal"
    }
  ]
}
```

| Field | Type | Required | Maps to |
|-------|------|----------|---------|
| `Naam` | string | yes | `Grower.name` |
| `Code` | string | yes | `Grower.code` |
| `ID` | integer | yes | Match key: `Grower.fabricId` |
| `Land Code` | string | no | (not stored, informational) |
| `Land Naam` | string | no | `Grower.country` |
| `Plaats` | string | no | `Grower.city` |

### Response

```json
{
  "received": 2687,
  "matched": 63,
  "updated": 58,
  "unchanged": 5,
  "notInDb": 2624,
  "errors": 0
}
```

### Behavior

Only Grower records that already exist (created via the orders import when a new `rel_id_kweker` appears) are updated. The `notInDb` count shows how many incoming kwekers had no matching Grower record — this is expected, as most kwekers don't have transactions through our suppliers.

---

## Power Automate Setup

### Flow: "Fabric → Grower Portal Sync" (runs 4x/day)

```
Recurrence trigger (every 6 hours)
  ↓
Step 1: Run DAX query — all suppliers (Dim_Leverancier)
Step 2: POST /api/import/suppliers (full set)
  ↓
Step 3: Run DAX query — partijen (last 48 hours)
Step 4: POST /api/import/lots
  ↓
Step 5: Run DAX query — orders (last 48 hours)
Step 6: POST /api/import/orders
  ↓
Step 7: Run DAX query — shcosts (last 48 hours)
Step 8: POST /api/import/costs
  ↓
Step 9: Run DAX query — all kwekers (Dim_Kweker)
Step 10: POST /api/import/growers (full set, enrichment only)
```

### HTTP action settings

- **Method:** POST
- **URI:** `https://growerportal-test.vercel.app/api/import/suppliers`
- **Headers:**
  - `Content-Type`: `application/json`
  - `Authorization`: `Bearer <your-api-key>`
- **Body:** JSON output from DAX query, wrapped in the expected root key (`suppliers`, `partijen`, `orders`, `costs`, or `growers`)

### DAX query window filter (48h example)

```dax
FILTER(
    table,
    [Lever Datum/Tijd] >= NOW() - 2
)
```

### Error handling

- All endpoints return HTTP 200 on success with a summary object
- HTTP 400: Invalid request body (check Zod validation errors in response)
- HTTP 401: Missing or invalid API key
- HTTP 500: Server error (check Vercel function logs)

Recommendation: add a "Condition" step after each HTTP action to check for non-200 status and send a notification email on failure.

---

## Notes

- **Decimals:** Power Automate should send numbers as JSON numbers (not comma-separated strings). The DAX output typically uses dots for decimals in JSON mode.
- **Nulls:** Optional fields can be `null` or omitted entirely.
- **Idempotent:** All endpoints are safe to call multiple times with the same data.
- **Order matters:** Suppliers must exist before lots can link to them. Lots must exist before orders can link to them. Growers are enriched after orders create them. Run in sequence: suppliers → lots → orders → costs → growers.
- **Vercel timeout:** Serverless functions have a 60-second timeout. For large batches (>5000 records), split into multiple requests.
