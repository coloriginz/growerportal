/*
 * Drieweg-reconciliatie voor PCFUP en COLBFL: salessheet-PDF, Fabric en portal.
 *
 * De PDF is leidend — dat is het document dat de kweker daadwerkelijk ontvangt.
 * Fabric en de portal horen daarop aan te sluiten. De vorige ronde (3-4 augustus
 * 2026, `docs/reconciliatie-pcfup-colbfl.md`) vond dat de portal structureel de
 * productieomzet miste: 100 van de 234 leveringen, samen EUR 22.931,52. Deze
 * ronde meet of dat nog zo is.
 *
 * De PDF-cijfers komen uit `private_input/recon-pdf-data.json`, het resultaat
 * van de PDF-uitlezing van toen. Die worden niet opnieuw geparst: de PDF's zijn
 * niet veranderd, de andere twee bronnen wel.
 *
 * Eén rij per levering, want daar hangt de afrekening aan: omzet, kosten en
 * netto uit alle drie de bronnen naast elkaar, met de verschillen erbij.
 *
 * Draaien (leesalleen, wijzigt niets):
 *   npx tsx scripts/recon-pdf-fabric-portal.ts
 *   npx tsx scripts/recon-pdf-fabric-portal.ts --out=pad/naar/bestand.xlsx
 */
import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/db";

const vereis = createRequire(import.meta.url);
const { queryFabric } = vereis("./lib/fabric-connection") as {
  queryFabric: (sql: string) => Promise<Record<string, unknown>[][]>;
};

const UIT =
  process.argv.slice(2).find((a) => a.startsWith("--out="))?.slice(6) ??
  path.join("private_input", "Reconciliatie PCFUP en COLBFL 2026-08-27.xlsx");

const LEVERANCIERS = ["PCFUP", "COLBFL"];

type PdfRecord = {
  parthdr_id: number;
  leverancier: string;
  pdf_nummer: string | null;
  pdf_leverdatum: string | null;
  direct_sales: number | null;
  turnover_auction: number | null;
  used_in_production: number | null;
  total_turnover: number | null;
  total_costs: number | null;
  to_be_received: number | null;
};

const n = (v: unknown): number => (v === null || v === undefined || v === "" ? 0 : Number(v));

/** Het oordeel dat de vorige ronde ook gebruikte, zodat de tellingen vergelijkbaar zijn. */
function oordeel(verschil: number): string {
  const a = Math.abs(verschil);
  if (a < 0.5) return "exact";
  if (a <= 5) return "binnen 5";
  if (a <= 50) return "binnen 50";
  return "groter dan 50";
}

async function main() {
  const pdfs: PdfRecord[] = JSON.parse(
    fs.readFileSync("private_input/recon-pdf-data.json", "utf8")
  );
  const parthdrIds = [...new Set(pdfs.map((p) => p.parthdr_id))];
  console.log(`PDF-leveringen: ${pdfs.length} over ${LEVERANCIERS.join(" en ")}`);

  // --- portal ---------------------------------------------------------------
  const sheets = await prisma.salesSheet.findMany({
    where: { fabricParthdrId: { in: parthdrIds } },
    select: {
      fabricParthdrId: true,
      invoiceNumber: true,
      ourInvoiceNumber: true,
      deliveryDate: true,
      totalTurnover: true,
      totalCosts: true,
      netResult: true,
      supplier: { select: { code: true } },
      _count: { select: { lots: true, costs: true } },
    },
  });
  const portalPer = new Map(sheets.map((s) => [s.fabricParthdrId!, s]));
  console.log(`portal: ${sheets.length} van ${parthdrIds.length} leveringen gevonden`);

  // --- Fabric ---------------------------------------------------------------
  const lijst = parthdrIds.join(",");
  const [omzetSets, kostenSets] = [
    await queryFabric(`
      SELECT parthdr_id,
             SUM(vor_aantal * afrekenprijs_per_steel) AS omzet,
             SUM(vor_aantal) AS stelen,
             COUNT(*) AS regels
      FROM marts.fct_orders
      WHERE parthdr_id IN (${lijst})
      GROUP BY parthdr_id`),
    await queryFabric(`
      SELECT parthdr_id,
             SUM(salesheet_amount) AS kosten,
             COUNT(*) AS regels
      FROM marts.fct_salesheets_costs
      WHERE parthdr_id IN (${lijst})
      GROUP BY parthdr_id`),
  ];
  const fabOmzet = new Map<number, { omzet: number; stelen: number; regels: number }>();
  for (const r of omzetSets[0] ?? []) {
    fabOmzet.set(Number(r.parthdr_id), {
      omzet: n(r.omzet),
      stelen: n(r.stelen),
      regels: n(r.regels),
    });
  }
  const fabKosten = new Map<number, { kosten: number; regels: number }>();
  for (const r of kostenSets[0] ?? []) {
    fabKosten.set(Number(r.parthdr_id), { kosten: n(r.kosten), regels: n(r.regels) });
  }
  console.log(`Fabric: omzet voor ${fabOmzet.size}, kosten voor ${fabKosten.size} leveringen`);

  // --- rijen ----------------------------------------------------------------
  const rijen = pdfs.map((p) => {
    const portal = portalPer.get(p.parthdr_id);
    const fo = fabOmzet.get(p.parthdr_id);
    const fk = fabKosten.get(p.parthdr_id);

    /*
     * Ontbreekt een bedrag op de PDF, dan blijft het leeg en vervalt het
     * verschil. Als nul behandelen maakt van een niet-uitgelezen nettobedrag een
     * verschil van duizenden euro's: drie PDF's dragen geen nettobedrag en twee
     * geen kostentotaal, en die tilden het nettoverschil in de eerste ronde in
     * hun eentje naar +EUR 12.595.
     */
    const pdfOmzet = p.total_turnover === null ? null : n(p.total_turnover);
    const pdfKosten = p.total_costs === null ? null : n(p.total_costs);
    const pdfNetto = p.to_be_received === null ? null : n(p.to_be_received);
    const verschil = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);

    const fabricOmzet = fo ? fo.omzet : null;
    const fabricKosten = fk ? fk.kosten : null;
    const fabricNetto =
      fabricOmzet === null && fabricKosten === null ? null : n(fabricOmzet) - n(fabricKosten);

    const portalOmzet = portal ? Number(portal.totalTurnover) : null;
    const portalKosten = portal ? Number(portal.totalCosts) : null;
    const portalNetto = portal ? Number(portal.netResult) : null;

    return {
      leverancier: p.leverancier,
      parthdrId: p.parthdr_id,
      pdfNummer: p.pdf_nummer,
      leverdatum: p.pdf_leverdatum,
      portalFactuur: portal?.invoiceNumber ?? null,
      onzeFactuur: portal?.ourInvoiceNumber ?? null,
      portalLeverdatum: portal ? portal.deliveryDate.toISOString().slice(0, 10) : null,
      pdfDirect: n(p.direct_sales),
      pdfVeiling: n(p.turnover_auction),
      pdfProductie: n(p.used_in_production),
      pdfOmzet,
      pdfKosten,
      pdfNetto,
      fabricOmzet,
      fabricKosten,
      fabricNetto,
      fabricStelen: fo?.stelen ?? null,
      fabricOrderregels: fo?.regels ?? null,
      fabricKostenregels: fk?.regels ?? null,
      portalOmzet,
      portalKosten,
      portalNetto,
      portalPartijen: portal?._count.lots ?? null,
      portalKostenregels: portal?._count.costs ?? null,
      /*
       * Draagt deze PDF alle drie de totalen? Alleen dan telt hij mee in de
       * samenvatting. Anders lopen de drie sommen over verschillende rijen —
       * twee leveringen zonder kostentotaal en drie zonder netto verschoven de
       * totalen met vijftienduizend euro, terwijl er niets mis was met de data.
       */
      volledig: pdfOmzet !== null && pdfKosten !== null && pdfNetto !== null,
      dFabricOmzet: verschil(fabricOmzet, pdfOmzet),
      dPortalOmzet: verschil(portalOmzet, pdfOmzet),
      dFabricKosten: verschil(fabricKosten, pdfKosten),
      dPortalKosten: verschil(portalKosten, pdfKosten),
      dPortalNetto: verschil(portalNetto, pdfNetto),
      oordeelFabric:
        verschil(fabricOmzet, pdfOmzet) === null
          ? "geen data"
          : oordeel(verschil(fabricOmzet, pdfOmzet)!),
      oordeelPortal:
        verschil(portalOmzet, pdfOmzet) === null
          ? "geen data"
          : oordeel(verschil(portalOmzet, pdfOmzet)!),
    };
  });

  await schrijfWerkboek(rijen);
  toonSamenvatting(rijen);
}

function toonSamenvatting(rijen: Record<string, unknown>[]) {
  const volledig = rijen.filter((r) => r.volledig);
  const tel = (veld: string, waarde: string) => rijen.filter((r) => r[veld] === waarde).length;
  const som = (veld: string) =>
    volledig.reduce((a, r) => a + (typeof r[veld] === "number" ? (r[veld] as number) : 0), 0);

  console.log("");
  console.log("omzet tegenover de PDF        Fabric   portal");
  for (const w of ["exact", "binnen 5", "binnen 50", "groter dan 50", "geen data"]) {
    console.log(
      "  " + w.padEnd(26) + String(tel("oordeelFabric", w)).padStart(6) +
        String(tel("oordeelPortal", w)).padStart(9)
    );
  }
  console.log("");
  console.log(`som van de verschillen (EUR) over ${volledig.length} leveringen met een complete PDF`);
  console.log("  Fabric - PDF omzet :", som("dFabricOmzet").toFixed(2));
  console.log("  portal - PDF omzet :", som("dPortalOmzet").toFixed(2));
  console.log("  Fabric - PDF kosten:", som("dFabricKosten").toFixed(2));
  console.log("  portal - PDF kosten:", som("dPortalKosten").toFixed(2));
  console.log("  portal - PDF netto :", som("dPortalNetto").toFixed(2));

  const metProductie = rijen.filter((r) => (r.pdfProductie as number) > 0);
  const mist = metProductie.filter(
    (r) => Math.abs((r.dPortalOmzet as number) + (r.pdfProductie as number)) < 0.5
  );
  console.log("");
  console.log(`leveringen met een productieregel: ${metProductie.length}`);
  console.log(`  waarvan de portal exact die productieomzet mist: ${mist.length}`);
}

async function schrijfWerkboek(rijen: Record<string, unknown>[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Grower Portal";
  wb.created = new Date();

  const ws = wb.addWorksheet("Leveringen", { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
  const kolommen: { header: string; key: string; width: number; format?: string }[] = [
    { header: "Leverancier", key: "leverancier", width: 12 },
    { header: "Levering (parthdr)", key: "parthdrId", width: 16 },
    { header: "PDF-nummer", key: "pdfNummer", width: 13 },
    { header: "Leverdatum portal", key: "portalLeverdatum", width: 17 },
    { header: "Leverdatum op PDF", key: "leverdatum", width: 17 },
    { header: "Shipment number", key: "portalFactuur", width: 18 },
    { header: "Onze factuur", key: "onzeFactuur", width: 13 },
    { header: "PDF direct", key: "pdfDirect", width: 12, format: "#,##0.00" },
    { header: "PDF veiling", key: "pdfVeiling", width: 12, format: "#,##0.00" },
    { header: "PDF productie", key: "pdfProductie", width: 13, format: "#,##0.00" },
    { header: "PDF omzet", key: "pdfOmzet", width: 13, format: "#,##0.00" },
    { header: "PDF kosten", key: "pdfKosten", width: 12, format: "#,##0.00" },
    { header: "PDF netto", key: "pdfNetto", width: 13, format: "#,##0.00" },
    { header: "Fabric omzet", key: "fabricOmzet", width: 13, format: "#,##0.00" },
    { header: "Fabric kosten", key: "fabricKosten", width: 13, format: "#,##0.00" },
    { header: "Fabric netto", key: "fabricNetto", width: 13, format: "#,##0.00" },
    { header: "Portal omzet", key: "portalOmzet", width: 13, format: "#,##0.00" },
    { header: "Portal kosten", key: "portalKosten", width: 13, format: "#,##0.00" },
    { header: "Portal netto", key: "portalNetto", width: 13, format: "#,##0.00" },
    { header: "Fabric - PDF omzet", key: "dFabricOmzet", width: 17, format: "#,##0.00" },
    { header: "Portal - PDF omzet", key: "dPortalOmzet", width: 17, format: "#,##0.00" },
    { header: "Fabric - PDF kosten", key: "dFabricKosten", width: 18, format: "#,##0.00" },
    { header: "Portal - PDF kosten", key: "dPortalKosten", width: 18, format: "#,##0.00" },
    { header: "Portal - PDF netto", key: "dPortalNetto", width: 17, format: "#,##0.00" },
    { header: "Oordeel Fabric", key: "oordeelFabric", width: 15 },
    { header: "Oordeel portal", key: "oordeelPortal", width: 15 },
    { header: "Fabric stelen", key: "fabricStelen", width: 13, format: "#,##0" },
    { header: "Fabric orderregels", key: "fabricOrderregels", width: 17, format: "#,##0" },
    { header: "Fabric kostenregels", key: "fabricKostenregels", width: 18, format: "#,##0" },
    { header: "Portal partijen", key: "portalPartijen", width: 14, format: "#,##0" },
    { header: "Portal kostenregels", key: "portalKostenregels", width: 18, format: "#,##0" },
  ];
  ws.columns = kolommen.map((k) => ({ header: k.header, key: k.key, width: k.width }));
  for (const rij of rijen) ws.addRow(rij);

  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolommen.length } };
  for (const [i, k] of kolommen.entries()) {
    if (k.format) ws.getColumn(i + 1).numFmt = k.format;
  }

  // Rood waar de portal meer dan een halve euro van de PDF af zit, groen waar hij klopt.
  const kolomPortal = kolommen.findIndex((k) => k.key === "dPortalOmzet") + 1;
  const kolomFabric = kolommen.findIndex((k) => k.key === "dFabricOmzet") + 1;
  for (let r = 2; r <= rijen.length + 1; r++) {
    for (const c of [kolomFabric, kolomPortal]) {
      const cel = ws.getCell(r, c);
      const v = typeof cel.value === "number" ? cel.value : null;
      if (v === null) continue;
      const goed = Math.abs(v) < 0.5;
      cel.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: goed ? "FFC6EFCE" : "FFFFC7CE" },
      };
      cel.font = { color: { argb: goed ? "FF006100" : "FF9C0006" } };
    }
  }

  const sam = wb.addWorksheet("Samenvatting");
  sam.columns = [
    { header: "", key: "a", width: 40 },
    { header: "Fabric", key: "b", width: 14 },
    { header: "Portal", key: "c", width: 14 },
  ];
  sam.getRow(1).font = { bold: true };
  const volledig = rijen.filter((r) => r.volledig);
  const tel = (veld: string, waarde: string) => rijen.filter((r) => r[veld] === waarde).length;
  for (const w of ["exact", "binnen 5", "binnen 50", "groter dan 50", "geen data"]) {
    sam.addRow({ a: `omzet tegenover PDF — ${w}`, b: tel("oordeelFabric", w), c: tel("oordeelPortal", w) });
  }
  // Sommen alleen over complete PDF's, anders lopen ze over verschillende rijen.
  const som = (veld: string) =>
    volledig.reduce((a, r) => a + (typeof r[veld] === "number" ? (r[veld] as number) : 0), 0);
  sam.addRow({});
  sam.addRow({ a: `som verschil omzet (EUR), ${volledig.length} complete PDF's`, b: som("dFabricOmzet"), c: som("dPortalOmzet") });
  sam.addRow({ a: "som verschil kosten (EUR)", b: som("dFabricKosten"), c: som("dPortalKosten") });
  sam.addRow({ a: "som verschil netto (EUR)", b: null, c: som("dPortalNetto") });
  sam.addRow({});
  const metProductie = rijen.filter((r) => (r.pdfProductie as number) > 0);
  sam.addRow({ a: "leveringen met een productieregel", b: null, c: metProductie.length });
  sam.addRow({
    a: "  waarvan de portal exact die productieomzet mist",
    b: null,
    c: metProductie.filter(
      (r) => Math.abs((r.dPortalOmzet as number) + (r.pdfProductie as number)) < 0.5
    ).length,
  });
  sam.addRow({ a: "totaal leveringen in deze recon", b: null, c: rijen.length });
  for (let r = 2; r <= sam.rowCount; r++) {
    for (const c of [2, 3]) {
      const cel = sam.getCell(r, c);
      if (typeof cel.value === "number" && !Number.isInteger(cel.value)) cel.numFmt = "#,##0.00";
    }
  }

  fs.mkdirSync(path.dirname(UIT), { recursive: true });
  await wb.xlsx.writeFile(UIT);
  console.log(`\nWerkboek: ${UIT}`);
}

main()
  .catch((e) => {
    console.error("FOUT:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
