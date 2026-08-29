import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { runImport } from "@/lib/import-batch";
import {
  planReattributionRemoval,
  type ReattributedSheet,
} from "@/lib/sync/reattribution";
import { isConsignment, purchaseTypeKey } from "@/lib/sync/purchase-type";

// Vercel kapt een functie zonder dit af op de standaardlimiet; de lots- en
// orders-import over een breed venster halen die niet.
export const maxDuration = 300;

const partijSchema = z.object({
  part_id: z.number(),
  parthdr_id: z.number(),
  rel_id_leverancier: z.number(),
  Partijnummer: z.union([z.string(), z.number()]),
  "Inkoop Factuur Nummer": z.string().nullable().optional(),
  "Lever Datum/Tijd": z.string().nullable().optional(),
  "Artikel Naam": z.string().nullable().optional(),
  "Artikel Code": z.string().nullable().optional(),
  "Inkooptype Code": z.string().nullable().optional(),
  S01: z.string().nullable().optional(),
  S02: z.string().nullable().optional(),
  S03: z.string().nullable().optional(),
  art_id: z.number().nullable().optional(),
  reden_id_correctie: z.number().nullable().optional(),
  "Inkoopfactuur colli": z.number().nullable().optional(),
  "Inkoopfactuur volume": z.number().nullable().optional(),
  "Inslagcorrectie volume": z.number().nullable().optional(), // legacy, replaced by "Inslag aantal correctie"
  "Inslag aantal correctie": z.number().nullable().optional(),
  "Facttype Sub": z.string().nullable().optional(),
});

type Partij = z.infer<typeof partijSchema>;

const partijKeys = Object.keys(partijSchema.shape);

const partijAliases = {
  // The one column in marts.fct_partijen whose name differs beyond spelling.
  // The rest matches once case, spaces and underscores are ignored.
  //
  // This used to point at inkoopfust_volume, which was wrong and never noticed
  // because only the DAX flow ran and that supplied the field directly.
  // inkoopfust_volume is a trolley fraction (0.053 to 0.16); this field feeds
  // totalStems and invoicedVolume, both integers, so the first SQL-driven round
  // died on "invalid input syntax for type integer: 0.16". Verified against six
  // lots: inkoop_factuur_aantal matches what the portal already holds.
  "Inkoopfactuur volume": ["inkoop_factuur_aantal"],
} as const;

/*
 * Haalt een levering volledig uit de portal, met alles wat eraan hangt.
 *
 * Drie dingen die niet vanzelf gaan en die je pas mist als iemand het merkt:
 *
 *  - `Lot.salesSheetId` is optioneel, dus partijen cascaderen níét mee met hun
 *    afrekening; ze zouden losgekoppeld achterblijven onder de oude leverancier.
 *    Ze worden daarom eerst apart verwijderd, waarna transacties, correcties en
 *    kwaliteitsmeldingen wél vanzelf meegaan (die staan op Cascade).
 *  - `SalesSheetCost` cascadeert wel mee met de afrekening.
 *  - Het gekoppelde `Document` hangt andersom (`SalesSheet.pdfDocumentId` wijst
 *    ernaar) en blijft dus staan — inclusief zijn eigen `supplierId`. Precies dat
 *    document is hier het gevoelige deel: het is de sales sheet-PDF van de ándere
 *    partij. Het gaat mee, tenzij een andere afrekening er nog aan hangt.
 *
 * De blob achter het document blijft staan. Die is alleen bereikbaar via een url
 * die nergens meer wordt getoond, en een blob weggooien vanuit een importroute is
 * een nevenwerking die niet meer terug te draaien is.
 */
async function verwijderLeveringen(sheetIds: string[]): Promise<number> {
  if (sheetIds.length === 0) return 0;

  const sheets = await prisma.salesSheet.findMany({
    where: { id: { in: sheetIds } },
    select: { id: true, pdfDocumentId: true },
  });
  const documentIds = [...new Set(sheets.map((s) => s.pdfDocumentId).filter(Boolean))] as string[];

  await prisma.lot.deleteMany({ where: { salesSheetId: { in: sheetIds } } });
  const verwijderd = await prisma.salesSheet.deleteMany({ where: { id: { in: sheetIds } } });

  if (documentIds.length > 0) {
    // Pas ná het verwijderen van de afrekening: zolang die er is, wijst haar
    // pdfDocumentId nog naar dit document.
    const nogInGebruik = await prisma.salesSheet.findMany({
      where: { pdfDocumentId: { in: documentIds } },
      select: { pdfDocumentId: true },
    });
    const bezet = new Set(nogInGebruik.map((s) => s.pdfDocumentId));
    const vrij = documentIds.filter((id) => !bezet.has(id));
    if (vrij.length > 0) {
      await prisma.document.deleteMany({ where: { id: { in: vrij } } });
    }
  }

  return verwijderd.count;
}

/** Classify a Facttype Sub value into base lot or correction */
function isCorrection(facttypeSub: string | null | undefined): boolean {
  if (!facttypeSub) return false;
  const lower = facttypeSub.toLowerCase().trim();
  return lower === "correctie" || lower === "productiecorrectie";
}

/** A row counts as an internal production booking when its Facttype Sub starts
 * with "productie" — this covers both "productie" and "productiecorrectie". */
function isProductie(facttypeSub: string | null | undefined): boolean {
  if (!facttypeSub) return false;
  return facttypeSub.toLowerCase().trim().startsWith("productie");
}

function deriveArticleGroup(productName: string): string {
  if (!productName) return "Unknown";
  return productName.trim().split(/\s+/)[0] || "Unknown";
}

export async function POST(request: NextRequest) {
  return runImport(request, {
    endpoint: "lots",
    // "partijen" is de naam die de DAX-flows sturen; "lots" die de
    // portal-gestuurde sync gebruikt, want die bouwt de sleutel op uit de
    // endpoint-naam. Beide moeten werken zolang de oude flows nog draaien.
    bodyKey: ["partijen", "lots"],
    rowSchema: partijSchema,
    schemaKeys: partijKeys,
    aliases: partijAliases,
    handler: async (partijen, batchId) => {
      if (partijen.length === 0) return { created: 0, updated: 0, skipped: 0 };
      return upsertLots(partijen, batchId);
    },
  });
}

async function upsertLots(partijen: Partij[], batchId: string | null) {
  // Alleen consignatie hoort in deze portal; Fabric levert ook koop-partijen.
  //
  // Dit filter staat bewust vóór de leverancierscontrole verderop. Die controle
  // houdt per rel_id bij wat er wegvalt (`details.skippedSuppliers`) en het
  // importscherm biedt die relaties aan met een knop om er een leverancier van
  // te maken. Filteren we ná die controle, dan blijven koop-relaties in dat
  // lijstje staan en nodigt het scherm uit om precies de verkeerde leveranciers
  // aan te zetten — wat gisteren gebeurde: één aangezette relatie bleek 100% CIF
  // en leverde 186 partijen en 415 orderregels op die hier niet horen.
  //
  // Correcties lopen door hetzelfde filter: ze komen uit dezelfde fct_partijen
  // en dragen dus dezelfde kolom. Een correctie op een koop-partij hoort net zo
  // goed weg te vallen, en zonder dit filter zou hij zijn koop-relatie alsnog in
  // skippedSuppliers zetten.
  const consignatie: Partij[] = [];
  const skippedPurchaseTypes = new Map<string, number>();
  for (const row of partijen) {
    if (isConsignment(row["Inkooptype Code"])) {
      consignatie.push(row);
      continue;
    }
    const key = purchaseTypeKey(row["Inkooptype Code"]);
    skippedPurchaseTypes.set(key, (skippedPurchaseTypes.get(key) ?? 0) + 1);
  }
  const skippedNotConsignment = partijen.length - consignatie.length;

  // Round IDs (DAX/Power Automate can send 1.0 instead of 1)
  for (const row of consignatie) {
    row.part_id = Math.round(row.part_id);
    row.parthdr_id = Math.round(row.parthdr_id);
    row.rel_id_leverancier = Math.round(row.rel_id_leverancier);
    if (row.art_id) row.art_id = Math.round(row.art_id);
    if (row.reden_id_correctie) row.reden_id_correctie = Math.round(row.reden_id_correctie);
  }

  // Split rows by Facttype Sub: base rows vs correction rows
  const baseRows = consignatie.filter((r) => !isCorrection(r["Facttype Sub"]));
  const correctionRows = consignatie.filter((r) => isCorrection(r["Facttype Sub"]));

  // Group by parthdr_id
  const byParthdr = new Map<number, typeof consignatie>();
  for (const row of baseRows) {
    if (!byParthdr.has(row.parthdr_id)) byParthdr.set(row.parthdr_id, []);
    byParthdr.get(row.parthdr_id)!.push(row);
  }

  /*
   * Leveringen waarvan de partijen het oneens zijn over de leverancier.
   *
   * De code hieronder leidt de leverancier van een hele levering af uit
   * `rows[0]`. Dat is vandaag terecht — warehouse-breed heeft geen enkele
   * `parthdr_id` meer dan één `rel_id_leverancier` (gemeten 26-08-2026, net als
   * `part_id`: nul) — maar het is een aanname, en een die niemand zou merken als
   * hij wegviel: alle partijen van de levering kregen dan stilzwijgend de
   * leverancier van de eerste rij, en dat is precies hoe data van de één bij de
   * ander belandt.
   *
   * Bij tegenspraak wordt de hele levering overgeslagen en gemeld. Niet gokken
   * en niet half importeren: een afrekening die voor de helft bij de verkeerde
   * leverancier staat is erger dan een afrekening die ontbreekt en waarover een
   * melding staat.
   */
  const gemengdeLeveringen = new Map<number, number[]>();
  for (const [parthdrId, rows] of byParthdr) {
    const relIds = new Set(rows.map((r) => r.rel_id_leverancier));
    if (relIds.size > 1) gemengdeLeveringen.set(parthdrId, [...relIds]);
  }

  const allParthdrIds = [...byParthdr.keys()];
  const allPartIds = baseRows.map((p) => p.part_id);

  // Phase 1: Pre-fetch all existing data in parallel (3 queries)
  const [suppliers, existingSalesSheets, existingLots] = await Promise.all([
    prisma.supplier.findMany({
      where: { fabricId: { not: null } },
      select: { id: true, fabricId: true },
    }),
    prisma.salesSheet.findMany({
      where: { fabricParthdrId: { in: allParthdrIds } },
      select: { id: true, fabricParthdrId: true },
    }),
    prisma.lot.findMany({
      where: { fabricPartId: { in: allPartIds } },
      select: { id: true, fabricPartId: true },
    }),
  ]);

  const supplierMap = new Map<number, string>();
  for (const s of suppliers) {
    if (s.fabricId) supplierMap.set(s.fabricId, s.id);
  }

  const ssMap = new Map<number, string>();
  for (const ss of existingSalesSheets) {
    if (ss.fabricParthdrId) ssMap.set(ss.fabricParthdrId, ss.id);
  }

  const lotExistsSet = new Set<number>();
  for (const l of existingLots) {
    if (l.fabricPartId) lotExistsSet.add(l.fabricPartId);
  }

  // Phase 2: Collect potential invoice numbers for new salessheets and check collisions
  const newSsInvoiceNumbers: string[] = [];
  for (const [parthdrId, rows] of byParthdr) {
    if (ssMap.has(parthdrId)) continue;
    if (gemengdeLeveringen.has(parthdrId)) continue;
    const supplierId = supplierMap.get(rows[0].rel_id_leverancier);
    if (!supplierId) continue;
    let inv = rows[0]["Inkoop Factuur Nummer"]?.trim() || null;
    if (!inv || ["", "xxx", "volgt", "test", "restpartijen"].includes(inv)) {
      inv = `FABRIC-${parthdrId}`;
    }
    newSsInvoiceNumbers.push(inv);
  }

  const existingInvoices =
    newSsInvoiceNumbers.length > 0
      ? await prisma.salesSheet.findMany({
          where: { invoiceNumber: { in: newSsInvoiceNumbers } },
          select: { invoiceNumber: true },
        })
      : [];
  const usedInvoiceNumbers = new Set(existingInvoices.map((inv) => inv.invoiceNumber));

  // Phase 3: Build salessheet operations
  let ssCreated = 0,
    ssUpdated = 0;
  let lotCreated = 0,
    lotUpdated = 0;
  let skipped = 0;

  /**
   * Welke leveranciers hun partijen zien verdwijnen omdat ze nog niet in de
   * portal bestaan. Dit overslaan gebeurde tot nu toe zonder enig spoor, en zo
   * zijn COLXROOD en COLXBAK 317 salessheets kwijtgeraakt: de import meldde
   * netjes "success" en niemand kon zien wát er niet was aangekomen.
   */
  const skippedByRelId = new Map<number, { partijen: number; productie: number }>();
  const noteSkipped = (relId: number, aantal: number, productie: number) => {
    const existing = skippedByRelId.get(relId) ?? { partijen: 0, productie: 0 };
    skippedByRelId.set(relId, {
      partijen: existing.partijen + aantal,
      productie: existing.productie + productie,
    });
  };

  /*
   * `supplierId` gaat mee in de bijwerking, en dat is geen detail.
   *
   * Fabric kan een levering aan een andere relatie toewijzen. Zolang de
   * bijwerking alleen de leverdatum zette, verhuisde de afrekening in de portal
   * nooit mee: eenmaal onder een leverancier aangemaakt bleef hij daar staan,
   * ook als het warehouse hem allang aan iemand anders gaf. Levering
   * "19883 Van Dijk" stond zo onder MDHAGED terwijl Fabric hem aan MDHAGE geeft,
   * en INT000072 onder COLXAFRI terwijl hij bij Ole Engai hoort. Een leverancier
   * zag dus omzet en kosten van een ander.
   *
   * Fabric is de bron voor deze toewijzing, dus de portal volgt hem.
   */
  const ssUpdateData: { fabricParthdrId: number; deliveryDate: string; supplierId: string }[] = [];

  /** Overgeslagen leveringen: `parthdr_id` -> de relatie die Fabric eraan geeft. */
  const overgeslagenParthdrs = new Map<number, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ssCreateData: any[] = [];

  for (const [parthdrId, rows] of byParthdr) {
    const firstRow = rows[0];
    // Tegenspraak over de leverancier: hier één keer geteld, en verderop in de
    // partijenlus opnieuw overgeslagen zonder te tellen.
    if (gemengdeLeveringen.has(parthdrId)) {
      skipped += rows.length;
      continue;
    }
    const supplierId = supplierMap.get(firstRow.rel_id_leverancier);
    if (!supplierId) {
      skipped += rows.length;
      const productieCount = rows.filter((r) => isProductie(r["Facttype Sub"])).length;
      noteSkipped(firstRow.rel_id_leverancier, rows.length, productieCount);
      // Onthouden welke levering dit was. Draagt de portal hem al, dan is dit
      // geen onbekende relatie maar een herbestemming, en dat is een zwaarder
      // signaal: er staat dan een afrekening bij een leverancier die hem
      // volgens Fabric niet meer heeft. Zie `herbestemdWeg` verderop.
      overgeslagenParthdrs.set(parthdrId, firstRow.rel_id_leverancier);
      continue;
    }

    const deliveryDate = firstRow["Lever Datum/Tijd"]
      ? new Date(firstRow["Lever Datum/Tijd"])
      : new Date();

    if (ssMap.has(parthdrId)) {
      ssUpdateData.push({
        fabricParthdrId: parthdrId,
        deliveryDate: deliveryDate.toISOString(),
        supplierId,
      });
      ssUpdated++;
    } else {
      let invoiceNumber = firstRow["Inkoop Factuur Nummer"]?.trim() || null;
      if (
        !invoiceNumber ||
        ["", "xxx", "volgt", "test", "restpartijen"].includes(invoiceNumber)
      ) {
        invoiceNumber = `FABRIC-${parthdrId}`;
      }
      if (usedInvoiceNumbers.has(invoiceNumber)) {
        invoiceNumber = `${invoiceNumber}-${parthdrId}`;
      }
      usedInvoiceNumbers.add(invoiceNumber);

      ssCreateData.push({
        invoiceNumber,
        fabricParthdrId: parthdrId,
        supplierId,
        invoiceDate: deliveryDate,
        deliveryDate,
        totalTurnover: 0,
        totalCosts: 0,
        netResult: 0,
      });
      ssCreated++;
    }
  }

  // Phase 4: Execute salessheet operations
  if (ssUpdateData.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "SalesSheet" AS t
       SET
         "deliveryDate" = (u.val->>'deliveryDate')::timestamp,
         "supplierId" = u.val->>'supplierId',
         "updatedAt" = NOW()
       FROM jsonb_array_elements($1::jsonb) AS u(val)
       WHERE t."fabricParthdrId" = (u.val->>'fabricParthdrId')::int`,
      JSON.stringify(ssUpdateData)
    );
  }

  if (ssCreateData.length > 0) {
    // Use raw SQL INSERT ... ON CONFLICT for bulk upsert + RETURNING to get IDs
    const ssJsonData = ssCreateData.map((d: Record<string, unknown>) => ({
      invoiceNumber: d.invoiceNumber,
      fabricParthdrId: d.fabricParthdrId,
      supplierId: d.supplierId,
      invoiceDate: d.invoiceDate instanceof Date ? d.invoiceDate.toISOString() : d.invoiceDate,
      deliveryDate: d.deliveryDate instanceof Date ? d.deliveryDate.toISOString() : d.deliveryDate,
      totalTurnover: d.totalTurnover ?? 0,
      totalCosts: d.totalCosts ?? 0,
      netResult: d.netResult ?? 0,
    }));

    // Insert with ON CONFLICT on fabricParthdrId (unique)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "SalesSheet" (
         id, "invoiceNumber", "fabricParthdrId", "supplierId",
         "invoiceDate", "deliveryDate", "totalTurnover", "totalCosts", "netResult",
         "createdAt", "updatedAt"
       )
       SELECT
         gen_random_uuid()::text,
         v.val->>'invoiceNumber',
         (v.val->>'fabricParthdrId')::int,
         v.val->>'supplierId',
         (v.val->>'invoiceDate')::timestamp,
         (v.val->>'deliveryDate')::timestamp,
         COALESCE((v.val->>'totalTurnover')::numeric, 0),
         COALESCE((v.val->>'totalCosts')::numeric, 0),
         COALESCE((v.val->>'netResult')::numeric, 0),
         NOW(),
         NOW()
       FROM jsonb_array_elements($1::jsonb) AS v(val)
       ON CONFLICT ("fabricParthdrId") DO UPDATE SET
         "supplierId" = EXCLUDED."supplierId",
         "deliveryDate" = EXCLUDED."deliveryDate",
         "updatedAt" = NOW()`,
      JSON.stringify(ssJsonData)
    );

    // Fetch all salessheet IDs (both new and existing) for lot creation
    const newSalesSheets = await prisma.salesSheet.findMany({
      where: {
        fabricParthdrId: {
          in: ssCreateData.map((d: { fabricParthdrId: number }) => d.fabricParthdrId),
        },
      },
      select: { id: true, fabricParthdrId: true },
    });
    for (const ss of newSalesSheets) {
      if (ss.fabricParthdrId) ssMap.set(ss.fabricParthdrId, ss.id);
    }
  }

  // Phase 5: Build lot operations
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lotUpdateData: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lotCreateData: any[] = [];

  for (const [parthdrId, rows] of byParthdr) {
    const firstRow = rows[0];
    // Al geteld in de afrekeningenlus hierboven.
    if (gemengdeLeveringen.has(parthdrId)) continue;
    const supplierId = supplierMap.get(firstRow.rel_id_leverancier);
    if (!supplierId) continue;

    const salesSheetId = ssMap.get(parthdrId);
    if (!salesSheetId) continue;

    const deliveryDate = firstRow["Lever Datum/Tijd"]
      ? new Date(firstRow["Lever Datum/Tijd"])
      : new Date();

    for (const row of rows) {
      const lotNumber = String(row.Partijnummer).trim();
      if (!lotNumber) {
        skipped++;
        continue;
      }

      const productName = row["Artikel Naam"]?.trim() || "Unknown";
      const stemLength = row.S01 ? parseInt(row.S01, 10) || 0 : 0;

      if (lotExistsSet.has(row.part_id)) {
        lotUpdateData.push({
          fabricPartId: row.part_id,
          // Leverancier en afrekening horen ook hier bij te werken, niet alleen
          // in de ON CONFLICT hieronder: een bestaande partij loopt langs dit
          // pad en zou anders achterblijven bij de leverancier waaronder hij
          // ooit is aangemaakt, terwijl zijn afrekening al verhuisd was.
          supplierId,
          salesSheetId,
          lotNumber,
          productName,
          articleGroup: deriveArticleGroup(productName),
          articleCode: row["Artikel Code"] || null,
          purchaseType: row["Inkooptype Code"] || null,
          s1: row.S01 || null,
          s2: row.S02 || null,
          s3: row.S03 || null,
          invoicedColli: row["Inkoopfactuur colli"] ?? null,
          invoicedVolume: row["Inkoopfactuur volume"] ?? null,
          // Beide namen, net als het correctiepad hieronder. De SQL-query stuurt
          // `Inslag aantal correctie`; alleen de legacy-naam lezen zette deze
          // kolom bij elke portal-gestuurde ronde op null, waarna fase 7 hem
          // alleen herstelde voor partijen met een correctieregel in diezelfde
          // payload. Vandaag valt dat niet op omdat geen enkele partij een
          // correctievolume heeft zonder correctieregels, maar het is toeval en
          // geen ontwerp.
          correctionVolume: row["Inslag aantal correctie"] ?? row["Inslagcorrectie volume"] ?? null,
        });
        lotUpdated++;
      } else {
        lotCreateData.push({
          lotNumber,
          refNumber: lotNumber,
          fabricPartId: row.part_id,
          fabricParthdrId: parthdrId,
          supplierId,
          salesSheetId,
          articleCode: row["Artikel Code"] || null,
          productName,
          articleGroup: deriveArticleGroup(productName),
          purchaseType: row["Inkooptype Code"] || null,
          fabricArticleId: row.art_id || null,
          colli: row["Inkoopfactuur colli"] || 0,
          stemLength,
          totalStems: row["Inkoopfactuur volume"] || 0,
          avgPrice: 0,
          totalAmount: 0,
          deliveryDate,
          status: "sold",
          s1: row.S01 || null,
          s2: row.S02 || null,
          s3: row.S03 || null,
          invoicedColli: row["Inkoopfactuur colli"] || null,
          invoicedVolume: row["Inkoopfactuur volume"] || null,
          correctionVolume: row["Inslag aantal correctie"] ?? row["Inslagcorrectie volume"] ?? null,
        });
        lotCreated++;
      }
    }
  }

  // Phase 6: Execute lot operations — deduplicate updates by fabricPartId
  if (lotUpdateData.length > 0) {
    const updateDedupMap = new Map<number, (typeof lotUpdateData)[0]>();
    for (const d of lotUpdateData) {
      updateDedupMap.set(d.fabricPartId, d);
    }
    const dedupCount = lotUpdateData.length - updateDedupMap.size;
    if (dedupCount > 0) {
      lotUpdated -= dedupCount;
      skipped += dedupCount;
    }
    // Replace with deduped array
    lotUpdateData.length = 0;
    lotUpdateData.push(...updateDedupMap.values());
  }
  if (lotUpdateData.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Lot" AS t
       SET
         "supplierId" = u.val->>'supplierId',
         "salesSheetId" = u.val->>'salesSheetId',
         "lotNumber" = u.val->>'lotNumber',
         "productName" = u.val->>'productName',
         "articleGroup" = u.val->>'articleGroup',
         "articleCode" = u.val->>'articleCode',
         "purchaseType" = u.val->>'purchaseType',
         s1 = u.val->>'s1',
         s2 = u.val->>'s2',
         s3 = u.val->>'s3',
         "invoicedColli" = (u.val->>'invoicedColli')::int,
         "invoicedVolume" = (u.val->>'invoicedVolume')::int,
         "correctionVolume" = (u.val->>'correctionVolume')::int,
         "lastImportBatchId" = $2,
         "updatedAt" = NOW()
       FROM jsonb_array_elements($1::jsonb) AS u(val)
       WHERE t."fabricPartId" = (u.val->>'fabricPartId')::int`,
      JSON.stringify(lotUpdateData),
      batchId
    );
  }

  if (lotCreateData.length > 0) {
    // Deduplicate by fabricPartId — PostgreSQL INSERT ON CONFLICT cannot affect the same row twice
    const dedupMap = new Map<number, Record<string, unknown>>();
    for (const d of lotCreateData) {
      dedupMap.set(d.fabricPartId as number, d);
    }
    const dedupedCreateData = [...dedupMap.values()];
    const dupCount = lotCreateData.length - dedupedCreateData.length;
    if (dupCount > 0) {
      lotCreated -= dupCount;
      skipped += dupCount;
    }

    const lotJsonData = dedupedCreateData.map((d: Record<string, unknown>) => ({
      lotNumber: d.lotNumber,
      refNumber: d.refNumber,
      fabricPartId: d.fabricPartId,
      fabricParthdrId: d.fabricParthdrId,
      supplierId: d.supplierId,
      salesSheetId: d.salesSheetId,
      articleCode: d.articleCode,
      productName: d.productName,
      articleGroup: d.articleGroup,
      purchaseType: d.purchaseType,
      fabricArticleId: d.fabricArticleId,
      colli: d.colli ?? 0,
      stemLength: d.stemLength ?? 0,
      totalStems: d.totalStems ?? 0,
      avgPrice: d.avgPrice ?? 0,
      totalAmount: d.totalAmount ?? 0,
      deliveryDate: d.deliveryDate instanceof Date ? d.deliveryDate.toISOString() : d.deliveryDate,
      status: d.status ?? "sold",
      s1: d.s1,
      s2: d.s2,
      s3: d.s3,
      invoicedColli: d.invoicedColli,
      invoicedVolume: d.invoicedVolume,
      correctionVolume: d.correctionVolume,
    }));

    const insertResult = await prisma.$executeRawUnsafe(
      `INSERT INTO "Lot" (
         id, "lotNumber", "refNumber", "fabricPartId", "fabricParthdrId",
         "supplierId", "salesSheetId", "articleCode", "productName", "articleGroup",
         "purchaseType", "fabricArticleId", colli, "stemLength", "totalStems",
         "avgPrice", "totalAmount", "deliveryDate", status,
         s1, s2, s3, "invoicedColli", "invoicedVolume", "correctionVolume",
         "lastImportBatchId",
         "createdAt", "updatedAt"
       )
       SELECT
         gen_random_uuid()::text,
         v.val->>'lotNumber',
         v.val->>'refNumber',
         (v.val->>'fabricPartId')::int,
         (v.val->>'fabricParthdrId')::int,
         v.val->>'supplierId',
         v.val->>'salesSheetId',
         v.val->>'articleCode',
         v.val->>'productName',
         v.val->>'articleGroup',
         v.val->>'purchaseType',
         (v.val->>'fabricArticleId')::int,
         COALESCE((v.val->>'colli')::int, 0),
         COALESCE((v.val->>'stemLength')::int, 0),
         COALESCE((v.val->>'totalStems')::int, 0),
         COALESCE((v.val->>'avgPrice')::numeric, 0),
         COALESCE((v.val->>'totalAmount')::numeric, 0),
         (v.val->>'deliveryDate')::timestamp,
         COALESCE(v.val->>'status', 'sold'),
         v.val->>'s1',
         v.val->>'s2',
         v.val->>'s3',
         (v.val->>'invoicedColli')::int,
         (v.val->>'invoicedVolume')::int,
         (v.val->>'correctionVolume')::int,
         $2,
         NOW(),
         NOW()
       FROM jsonb_array_elements($1::jsonb) AS v(val)
       ON CONFLICT ("fabricPartId") DO UPDATE SET
         -- Leverancier en afrekening volgen Fabric mee. Zonder deze twee bleef
         -- een partij hangen bij de leverancier waaronder hij ooit is
         -- aangemaakt, ook nadat het warehouse hem had herbestemd. Botsen op
         -- (lotNumber, supplierId) kan in theorie; gemeten over 67.393 partijen
         -- komt geen enkel partijnummer bij twee leveranciers voor.
         "supplierId" = EXCLUDED."supplierId",
         "salesSheetId" = EXCLUDED."salesSheetId",
         "lotNumber" = EXCLUDED."lotNumber",
         "productName" = EXCLUDED."productName",
         "articleGroup" = EXCLUDED."articleGroup",
         "articleCode" = EXCLUDED."articleCode",
         "purchaseType" = EXCLUDED."purchaseType",
         s1 = EXCLUDED.s1,
         s2 = EXCLUDED.s2,
         s3 = EXCLUDED.s3,
         "invoicedColli" = EXCLUDED."invoicedColli",
         "invoicedVolume" = EXCLUDED."invoicedVolume",
         "correctionVolume" = EXCLUDED."correctionVolume",
         "lastImportBatchId" = EXCLUDED."lastImportBatchId",
         "updatedAt" = NOW()`,
      JSON.stringify(lotJsonData),
      batchId
    );
    // insertResult = number of rows affected (inserts + updates)
    // Adjust counts: if some were actually updates (ON CONFLICT), our lotCreated count is too high
    const actualAffected = Number(insertResult);
    if (actualAffected < lotCreateData.length) {
      const diff = lotCreateData.length - actualAffected;
      lotCreated -= diff;
      skipped += diff;
    }
  }

  // Phase 7: Process correction rows → LotCorrection records
  // Strategy: delete+insert per part_id (no unique key exists for corrections)
  let correctionsCreated = 0;
  let correctionsDeleted = 0;
  let correctionsSkipped = 0;

  /*
   * De partijen waarvan deze ronde de correcties mag herschrijven: alles wat de
   * payload draagt en waarvan we de leverancier kennen — niet alleen de partijen
   * die tóévallig een correctieregel meebrengen.
   *
   * Dat onderscheid was het lek. De opruiming keek naar `corrInsertData`, dus een
   * partij waarvan de láátste correctie in Fabric verviel, kwam in geen enkele
   * volgende ronde meer voor en hield zijn dode correctieregel voor altijd —
   * dezelfde vorm als de ingetrokken orderregels, zie `src/lib/sync/withdrawal.ts`.
   * Hier is het simpeler op te lossen dan daar: alle 17.056 correcties dragen het
   * `part_id` van hun moederpartij (gemeten 29-08-2026, nul uitzonderingen), dus
   * de partijen uit de payload dekken ook de correcties die eraan hingen.
   */
  const payloadPartIds = [
    ...new Set(
      consignatie.filter((r) => supplierMap.has(r.rel_id_leverancier)).map((r) => r.part_id)
    ),
  ];

  if (payloadPartIds.length > 0) {
    // Find parent lots for correction rows by lotNumber + supplier
    const corrLotNumbers = [...new Set(correctionRows.map((r) => String(r.Partijnummer).trim()))];
    const corrSupplierFabricIds = [...new Set(correctionRows.map((r) => r.rel_id_leverancier))];
    const corrSupplierIds = corrSupplierFabricIds
      .map((fid) => supplierMap.get(fid))
      .filter(Boolean) as string[];

    const parentLots = corrSupplierIds.length > 0 && corrLotNumbers.length > 0
      ? await prisma.lot.findMany({
          where: {
            lotNumber: { in: corrLotNumbers },
            supplierId: { in: corrSupplierIds },
          },
          select: { id: true, lotNumber: true, supplierId: true },
        })
      : [];

    // Build lookup: "lotNumber::supplierId" → lot.id
    const lotLookup = new Map<string, string>();
    for (const lot of parentLots) {
      lotLookup.set(`${lot.lotNumber}::${lot.supplierId}`, lot.id);
    }

    // Build insert data for all correction rows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const corrInsertData: any[] = [];

    for (const row of correctionRows) {
      const lotNumber = String(row.Partijnummer).trim();
      const supplierId = supplierMap.get(row.rel_id_leverancier);
      if (!supplierId) {
        correctionsSkipped++;
        noteSkipped(row.rel_id_leverancier, 1, isProductie(row["Facttype Sub"]) ? 1 : 0);
        continue;
      }

      const lotId = lotLookup.get(`${lotNumber}::${supplierId}`);
      if (!lotId) {
        correctionsSkipped++;
        continue;
      }

      corrInsertData.push({
        lotId,
        fabricPartId: row.part_id,
        facttypeSub: row["Facttype Sub"]?.toLowerCase().trim() || "correctie",
        correctionReasonId: row.reden_id_correctie || null,
        correctionVolume: row["Inslag aantal correctie"] ?? row["Inslagcorrectie volume"] ?? null,
      });
    }

    /*
     * Eerst opschrijven wélke partijen nu een correctie dragen, want `deleteMany`
     * geeft alleen een aantal terug. Een partij die er na deze ronde geen meer
     * heeft moet zijn aggregaat terug naar leeg, en zonder deze lijst weet de
     * herberekening hieronder niet dat hij bestaat.
     */
    const hadCorrecties = await prisma.lotCorrection.findMany({
      where: { fabricPartId: { in: payloadPartIds } },
      select: { lotId: true },
    });

    const deleteResult = await prisma.lotCorrection.deleteMany({
      where: { fabricPartId: { in: payloadPartIds } },
    });
    correctionsDeleted = deleteResult.count;

    if (corrInsertData.length > 0) {
      // Insert all correction rows
      await prisma.$executeRawUnsafe(
        `INSERT INTO "LotCorrection" (
           id, "lotId", "fabricPartId", "facttypeSub",
           "correctionReasonId", "correctionVolume", "correctionColli",
           "lastImportBatchId",
           "createdAt", "updatedAt"
         )
         SELECT
           gen_random_uuid()::text,
           v.val->>'lotId',
           (v.val->>'fabricPartId')::int,
           v.val->>'facttypeSub',
           (v.val->>'correctionReasonId')::int,
           (v.val->>'correctionVolume')::int,
           NULL,
           $2,
           NOW(),
           NOW()
         FROM jsonb_array_elements($1::jsonb) AS v(val)`,
        JSON.stringify(corrInsertData),
        batchId
      );
      correctionsCreated = corrInsertData.length;
    }

    /*
     * Het aggregaat bijwerken van elke partij die deze ronde een correctie kreeg
     * óf er een verloor. Die tweede helft ontbrak: de bron was alleen
     * `corrInsertData`, en de subquery las `LotCorrection` — dus een partij
     * zonder correcties leverde geen rij op en hield zijn oude `correctionVolume`
     * staan, ook nadat de laatste correctie was verdwenen.
     *
     * De LEFT JOIN zet zo'n partij terug op NULL. Bewust alleen voor partijen die
     * correcties hadden of kregen: `correctionVolume` wordt óók door de
     * partijregel zelf geschreven (`Inslag aantal correctie`), en een partij die
     * nooit een correctie had mag deze ronde niet leegmaken.
     */
    const affectedLotIds = [
      ...new Set([
        ...corrInsertData.map((d: { lotId: string }) => d.lotId),
        ...hadCorrecties.map((c) => c.lotId),
      ]),
    ];

    if (affectedLotIds.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Lot" AS l
         SET "correctionVolume" = sub.total_vol,
             "updatedAt" = NOW()
         FROM (
           SELECT ids.id AS "lotId", SUM(c."correctionVolume") AS total_vol
           FROM unnest($1::text[]) AS ids(id)
           LEFT JOIN "LotCorrection" c ON c."lotId" = ids.id
           GROUP BY ids.id
         ) AS sub
         WHERE l.id = sub."lotId"`,
        affectedLotIds
      );
    }
  }

  // Correcties kennen geen sleutel, dus ze worden per part_id weggegooid en
  // opnieuw weggeschreven. Ze allemaal als "created" tellen laat een ronde die
  // niets nieuws vond twintig nieuwe correcties melden — dezelfde vertekening
  // als bij de orderregels. Wat er stond en teruggezet is, is een wijziging.
  const correctionsUpdated = Math.min(correctionsCreated, correctionsDeleted);
  const correctionsNew = correctionsCreated - correctionsUpdated;

  /*
   * Leveringen die de portal al heeft, maar die Fabric aan een relatie geeft
   * die hier geen leverancier is.
   *
   * Dat is iets anders dan een onbekende relatie waarvan we nog nooit iets
   * zagen: deze afrekening staat nú bij een leverancier die hem volgens de bron
   * niet meer heeft, en die ziet dus omzet en kosten van een ander. Het verdient
   * een eigen melding, anders verdwijnt het in het aantal overgeslagen partijen.
   *
   * Melden én weghalen. Er is geen leverancier om hem heen te zetten, en juist
   * daarom hoort hij hier niet: dezelfde partij zou bij het binnenkomen zijn
   * weggegooid omdat zijn relatie geen portalleverancier is. Hem laten staan
   * omdat hij er toevallig al was, is die regel alleen niet toepassen op het
   * moment dat het uitmaakt. Zie `src/lib/sync/reattribution.ts` voor waarom dat
   * meer kost dan een verkeerd getal op een scherm.
   *
   * Wordt de relatie later alsnog geactiveerd, dan haalt een backfill de levering
   * gewoon opnieuw op, dan wel onder de juiste leverancier.
   */
  const herbestemdWeg: Record<string, { leveringen: number; van: string[] }> = {};
  let herbestemdVerwijderd = 0;
  let herbestemdNietVerwijderd: string | null = null;

  if (overgeslagenParthdrs.size > 0) {
    const bestaand = await prisma.salesSheet.findMany({
      where: { fabricParthdrId: { in: [...overgeslagenParthdrs.keys()] } },
      select: { id: true, fabricParthdrId: true, supplier: { select: { code: true } } },
    });

    const herbestemd: ReattributedSheet[] = [];
    for (const sheet of bestaand) {
      const relId = overgeslagenParthdrs.get(sheet.fabricParthdrId!);
      if (relId === undefined) continue;
      const sleutel = String(relId);
      const entry = herbestemdWeg[sleutel] ?? { leveringen: 0, van: [] };
      entry.leveringen++;
      if (!entry.van.includes(sheet.supplier.code)) entry.van.push(sheet.supplier.code);
      herbestemdWeg[sleutel] = entry;
      herbestemd.push({
        id: sheet.id,
        parthdrId: sheet.fabricParthdrId!,
        supplierCode: sheet.supplier.code,
        relId,
      });
    }

    const plan = planReattributionRemoval({ sheets: herbestemd });
    if (plan.mode === "remove") {
      herbestemdVerwijderd = await verwijderLeveringen(plan.sheets.map((s) => s.id));
    } else if (herbestemd.length > 0) {
      herbestemdNietVerwijderd = plan.reason;
    }
  }

  return {
    created: lotCreated + correctionsNew,
    updated: lotUpdated + correctionsUpdated,
    // recordsSkipped is "weggegooid", en dat zijn nu twee dingen: rijen zonder
    // leverancier en rijen van het verkeerde inkooptype. Beide tellen mee, maar
    // ze blijven in details uit elkaar te houden — skippedSuppliers per rel_id,
    // skippedPurchaseTypes per code.
    skipped: skipped + correctionsSkipped + skippedNotConsignment,
    details: {
      salesSheets: { created: ssCreated, updated: ssUpdated },
      lots: { created: lotCreated, updated: lotUpdated },
      corrections: {
        created: correctionsNew,
        updated: correctionsUpdated,
        written: correctionsCreated,
        deleted: correctionsDeleted,
        skipped: correctionsSkipped,
      },
      // Hoeveel partijen er per inkooptype zijn weggegooid. Dit is tegelijk de
      // controle op CONSIGNMENT_PURCHASE_TYPES: staat hier een code die we niet
      // kennen, dan gooien we mogelijk iets weg dat wél consignatie is.
      skippedPurchaseTypes: Object.fromEntries(
        [...skippedPurchaseTypes.entries()].sort((a, b) => b[1] - a[1])
      ),
      // Per rel_id hoeveel er is weggegooid omdat de leverancier ontbrak. De
      // drukste vijftig, want bij een backfill over jaren kunnen dit er honderden
      // zijn en de melding staat in een databasekolom.
      skippedSuppliers: Object.fromEntries(
        [...skippedByRelId.entries()]
          .sort((a, b) => b[1].partijen - a[1].partijen)
          .slice(0, 50)
      ),
      // Alleen aanwezig als er iets te melden is; anders draagt elke batch een
      // lege sleutel en gaat de betekenis van zijn aanwezigheid verloren.
      ...(Object.keys(herbestemdWeg).length > 0 ? { reattributedAway: herbestemdWeg } : {}),
      // Hoeveel leveringen daadwerkelijk uit de portal zijn gehaald. Apart van
      // reattributedAway, want melden en weghalen zijn twee verschillende feiten
      // en de bovengrens kan het tweede tegenhouden zonder het eerste.
      ...(herbestemdVerwijderd > 0 ? { reattributedRemoved: herbestemdVerwijderd } : {}),
      ...(herbestemdNietVerwijderd ? { reattributedKept: herbestemdNietVerwijderd } : {}),
      ...(gemengdeLeveringen.size > 0
        ? { mixedSupplierDeliveries: Object.fromEntries(gemengdeLeveringen) }
        : {}),
    },
    extra: {
      salesSheets: { created: ssCreated, updated: ssUpdated },
      lots: { created: lotCreated, updated: lotUpdated },
      corrections: {
        created: correctionsNew,
        updated: correctionsUpdated,
        written: correctionsCreated,
        deleted: correctionsDeleted,
        skipped: correctionsSkipped,
      },
      skipped,
      skippedNotConsignment,
    },
  };
}
