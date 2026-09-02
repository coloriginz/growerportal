/*
 * Zet elke afrekening waar de gedrukte omzet afwijkt van de berekende in Excel.
 *
 * De tegenhanger van `scripts/export-cost-differences.ts`, en de grotere helft: van
 * de leveringen waarvan het nettoresultaat afwijkt zit het bij 152 van de 219 aan de
 * omzetkant. Daar helpt geen kostenronde tegen — dat is het verhaal van de partijen
 * en de orderregels, en dit werkboek legt het per levering en per partij neer.
 *
 * Alles komt uit de database; er wordt geen PDF gelezen. De uitgebreide analyse per
 * regel van de afrekening staat in `scripts/recon-salessheet-lines.ts`, die de
 * partijtabel van het document erbij haalt. Dit werkboek is het snelle overzicht dat
 * na elke syncronde opnieuw te draaien is.
 *
 * Draaien:
 *   npx tsx scripts/export-turnover-differences.ts
 *   npx tsx scripts/export-turnover-differences.ts --drempel=1
 */
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/db";

function optie(vlag: string): string | undefined {
  const a = process.argv.slice(2).find((x) => x.startsWith(vlag + "="));
  return a ? a.slice(vlag.length + 1) : undefined;
}
const DREMPEL = Number(optie("--drempel") ?? 0.01);
const UIT = optie("--uit") ?? path.join("private_input", "omzetverschillen.xlsx");

/** Marge waarbinnen een verklaring het gat "precies" dekt: een cent of één procent. */
const dekt = (verklaring: number, gat: number) =>
  Math.abs(verklaring - gat) <= Math.max(0.02, Math.abs(gat) * 0.01);

const rond = (n: number) => Number(n.toFixed(2));
const datum = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

async function main() {
  const sheets = await prisma.salesSheet.findMany({
    where: { pdfTurnover: { not: null } },
    select: {
      invoiceNumber: true,
      ourInvoiceNumber: true,
      deliveryDate: true,
      pdfInvoiceDate: true,
      totalTurnover: true,
      totalCosts: true,
      netResult: true,
      pdfTurnover: true,
      pdfCosts: true,
      pdfNetResult: true,
      supplier: { select: { code: true, name: true } },
      pdfDocument: { select: { fileName: true } },
      lots: {
        select: {
          lotNumber: true,
          productName: true,
          invoicedVolume: true,
          grower: { select: { code: true } },
          transactions: { select: { stems: true, amount: true, bronFeitExtra: true } },
        },
        orderBy: { lotNumber: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });

  type Rij = Record<string, string | number | null>;
  const rijen: Rij[] = [];
  const partijen: Rij[] = [];
  const perKlasse = new Map<string, number>();
  let nettoOpmaak = 0;

  for (const s of sheets) {
    const omzetPdf = Number(s.pdfTurnover);
    const nettoPdf = s.pdfNetResult === null ? null : Number(s.pdfNetResult);
    const kostenPdf = s.pdfCosts === null ? null : Number(s.pdfCosts);
    const portalKosten = Number(s.totalCosts);

    /*
     * De netto-opmaak eerst wegzetten. Een blad dat de kosten al per regel verrekent
     * drukt geen bruto-omzet af; de kop-parser leest daar hetzelfde getal als omzet
     * én als netto. Die 229 leveringen naast de bruto-omzet van de portal leggen
     * levert duizenden euro's schijnverschil op — COLSEMPC 128 alleen al EUR 13.271.
     * Zelfde toets als in `recon-salessheet-lines.ts`: geen kostenblok op het blad,
     * omzet gelijk aan netto, en de portal kent voor deze levering wél kosten.
     */
    if (kostenPdf === null && nettoPdf !== null && Math.abs(omzetPdf - nettoPdf) <= 0.02 && portalKosten > 0.02) {
      nettoOpmaak++;
      continue;
    }

    const omzetPortal = Number(s.totalTurnover);
    const d = rond(omzetPdf - omzetPortal);
    if (Math.abs(d) <= DREMPEL) continue;

    // Alle boekingen tellen, niet alleen `origineel`: een gecorrigeerde orderregel
    // wordt tegengeboekt en opnieuw geboekt, en het saldo is wat de afrekening drukt.
    const tegen = s.lots.flatMap((l) => l.transactions.filter((t) => t.bronFeitExtra !== "origineel"));
    const tegenBedrag = rond(tegen.reduce((a, t) => a + Number(t.amount), 0));
    const zonderVerkoop = s.lots.filter((l) => l.transactions.length === 0 && (l.invoicedVolume ?? 0) > 0);
    const zonderVerkoopStelen = zonderVerkoop.reduce((a, l) => a + (l.invoicedVolume ?? 0), 0);

    // Is het gat precies één partij groot? Dan wijst het geval zichzelf aan.
    const perPartij = s.lots.map((l) => ({
      lot: l,
      bedrag: rond(l.transactions.reduce((a, t) => a + Number(t.amount), 0)),
    }));
    const eenPartij = perPartij.find((p) => p.bedrag !== 0 && dekt(Math.abs(p.bedrag), Math.abs(d)));

    let klasse: string;
    let verklaring: string;
    if (zonderVerkoop.length > 0) {
      klasse = "partij zonder enkele verkoop";
      verklaring =
        `${zonderVerkoop.length} partij(en) met samen ${zonderVerkoopStelen} aangevoerde stelen en geen enkele transactie: ` +
        zonderVerkoop.map((l) => l.lotNumber).join(", ");
    } else if (tegen.length > 0 && dekt(-tegenBedrag, d)) {
      klasse = "tegenboekingen dekken het gat";
      verklaring = `${tegen.length} tegenboeking(en) van samen EUR ${tegenBedrag.toFixed(2)}; de afrekening drukt die niet af of zet ze op EUR 0,00.`;
    } else if (eenPartij) {
      klasse = "het gat is precies één partij";
      verklaring = `Partij ${eenPartij.lot.lotNumber} (${eenPartij.lot.grower?.code ?? "?"}) draagt EUR ${Math.abs(eenPartij.bedrag).toFixed(2)}.`;
    } else if (tegen.length > 0) {
      klasse = "tegenboekingen aanwezig, dekken het gat niet";
      verklaring = `${tegen.length} tegenboeking(en) van samen EUR ${tegenBedrag.toFixed(2)}, tegenover een gat van EUR ${d.toFixed(2)}.`;
    } else {
      klasse = "niet toe te wijzen";
      verklaring = "Geen partij zonder verkoop, geen tegenboekingen, en geen enkele partij ter grootte van het gat.";
    }
    perKlasse.set(klasse, (perKlasse.get(klasse) ?? 0) + 1);

    rijen.push({
      leverancier: s.supplier.code,
      leveranciernaam: s.supplier.name,
      levering: String(s.invoiceNumber),
      onsFactuurnummer: s.ourInvoiceNumber ?? "",
      leverdatum: datum(s.deliveryDate),
      factuurdatumPdf: datum(s.pdfInvoiceDate),
      partijen: s.lots.length,
      omzetPortal: rond(omzetPortal),
      omzetPdf: rond(omzetPdf),
      verschilOmzet: d,
      kostenPortal: rond(portalKosten),
      kostenPdf: kostenPdf === null ? null : rond(kostenPdf),
      verschilKosten: kostenPdf === null ? null : rond(kostenPdf - portalKosten),
      nettoPortal: rond(Number(s.netResult)),
      nettoPdf: nettoPdf === null ? null : rond(nettoPdf),
      verschilNetto: nettoPdf === null ? null : rond(nettoPdf - Number(s.netResult)),
      tegenboekingen: tegen.length,
      bedragTegenboekingen: tegenBedrag,
      klasse,
      verklaring,
      bestand: s.pdfDocument?.fileName ?? "",
    });

    for (const p of perPartij) {
      const verkocht = p.lot.transactions.reduce((a, t) => a + t.stems, 0);
      partijen.push({
        Leverancier: s.supplier.code,
        Levering: String(s.invoiceNumber),
        Leverdatum: datum(s.deliveryDate),
        Partij: p.lot.lotNumber,
        Kweker: p.lot.grower?.code ?? "",
        Product: p.lot.productName,
        Aangevoerd: p.lot.invoicedVolume ?? 0,
        Verkocht: verkocht,
        Boekingen: p.lot.transactions.length,
        Omzet: p.bedrag,
        "Verschil op de levering": d,
      });
    }
  }

  console.log(`afrekeningen met een gelezen omzet     : ${sheets.length}`);
  console.log(`overgeslagen (netto-opmaak, niet vergelijkbaar): ${nettoOpmaak}`);
  console.log(`met een verschil > ${DREMPEL}                  : ${rijen.length}`);
  for (const [k, n] of [...perKlasse].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log(`som van de absolute verschillen        : EUR ${rijen.reduce((s, r) => s + Math.abs(r.verschilOmzet as number), 0).toFixed(2)}`);

  await schrijf(rijen, partijen, perKlasse, sheets.length, nettoOpmaak);
  console.log(`\nwerkboek: ${UIT}`);
}

async function schrijf(
  rijen: Record<string, string | number | null>[],
  partijen: Record<string, string | number | null>[],
  perKlasse: Map<string, number>,
  gelezen: number,
  nettoOpmaak: number
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "growerportal";
  wb.created = new Date();
  const kop = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4EDE4" } };
  };

  const ws = wb.addWorksheet("Omzetverschillen", { views: [{ state: "frozen", xSplit: 3, ySplit: 1 }] });
  ws.columns = [
    { header: "Leverancier", key: "leverancier", width: 12 },
    { header: "Naam", key: "leveranciernaam", width: 26 },
    { header: "Levering", key: "levering", width: 18 },
    { header: "Ons factuurnr", key: "onsFactuurnummer", width: 14 },
    { header: "Leverdatum", key: "leverdatum", width: 12 },
    { header: "Factuurdatum PDF", key: "factuurdatumPdf", width: 16 },
    { header: "Partijen", key: "partijen", width: 9 },
    { header: "Omzet portal", key: "omzetPortal", width: 13 },
    { header: "Omzet PDF", key: "omzetPdf", width: 12 },
    { header: "Verschil omzet", key: "verschilOmzet", width: 14 },
    { header: "Kosten portal", key: "kostenPortal", width: 13 },
    { header: "Kosten PDF", key: "kostenPdf", width: 12 },
    { header: "Verschil kosten", key: "verschilKosten", width: 14 },
    { header: "Netto portal", key: "nettoPortal", width: 13 },
    { header: "Netto PDF", key: "nettoPdf", width: 12 },
    { header: "Verschil netto", key: "verschilNetto", width: 14 },
    { header: "Tegenboekingen", key: "tegenboekingen", width: 15 },
    { header: "Bedrag tegenboekingen", key: "bedragTegenboekingen", width: 20 },
    { header: "Klasse", key: "klasse", width: 34 },
    { header: "Verklaring", key: "verklaring", width: 80 },
    { header: "Bestand", key: "bestand", width: 44 },
  ];
  kop(ws);
  for (const r of [...rijen].sort(
    (a, b) => Math.abs(b.verschilOmzet as number) - Math.abs(a.verschilOmzet as number)
  ))
    ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  for (const k of ["omzetPortal", "omzetPdf", "verschilOmzet", "kostenPortal", "kostenPdf",
    "verschilKosten", "nettoPortal", "nettoPdf", "verschilNetto", "bedragTegenboekingen"])
    ws.getColumn(k).numFmt = "#,##0.00";

  const wp = wb.addWorksheet("Partijen", { views: [{ state: "frozen", ySplit: 1 }] });
  wp.columns = [
    { header: "Leverancier", key: "Leverancier", width: 12 },
    { header: "Levering", key: "Levering", width: 18 },
    { header: "Leverdatum", key: "Leverdatum", width: 12 },
    { header: "Partij", key: "Partij", width: 11 },
    { header: "Kweker", key: "Kweker", width: 12 },
    { header: "Product", key: "Product", width: 34 },
    { header: "Aangevoerd", key: "Aangevoerd", width: 12 },
    { header: "Verkocht", key: "Verkocht", width: 10 },
    { header: "Boekingen", key: "Boekingen", width: 11 },
    { header: "Omzet", key: "Omzet", width: 12 },
    { header: "Verschil op de levering", key: "Verschil op de levering", width: 20 },
  ];
  kop(wp);
  for (const r of partijen) wp.addRow(r);
  wp.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };
  for (const k of ["Aangevoerd", "Verkocht"]) wp.getColumn(k).numFmt = "#,##0";
  for (const k of ["Omzet", "Verschil op de levering"]) wp.getColumn(k).numFmt = "#,##0.00";

  const samen = wb.addWorksheet("Samenvatting");
  samen.columns = [
    { header: "", key: "a", width: 60 },
    { header: "", key: "b", width: 16 },
  ];
  const regel = (a: string, b: string | number = "") => samen.addRow({ a, b });
  regel("Omzetverschillen tussen de afrekening en de portal");
  regel("gedraaid op", new Date().toISOString().slice(0, 16).replace("T", " "));
  regel("drempel", `EUR ${DREMPEL}`);
  regel();
  regel("afrekeningen waarvan de omzet uit de PDF is gelezen", gelezen);
  regel("  overgeslagen: netto-opmaak, bedragen niet vergelijkbaar", nettoOpmaak);
  regel("  met een verschil", rijen.length);
  regel("som van de absolute verschillen", rond(rijen.reduce((s, r) => s + Math.abs(r.verschilOmzet as number), 0)));
  regel();
  regel("Naar klasse");
  for (const [k, n] of [...perKlasse].sort((a, b) => b[1] - a[1])) regel("  " + k, n);
  regel();
  regel("Hoe te lezen");
  for (const t of [
    "Verschil is altijd PDF min portal. Negatief betekent: de portal telt meer",
    "omzet dan er op de afrekening staat.",
    "De portalkant telt álle boekingen op een partij, ook de tegenboekingen. Een",
    "gecorrigeerde orderregel wordt in Fabric niet overschreven maar tegengeboekt",
    "en opnieuw geboekt, en het saldo is wat de afrekening afdrukt.",
    "Afrekeningen die de kosten al per regel verrekenen zijn overgeslagen: die",
    "drukken geen bruto-omzet af, dus daar is geen omzet om mee te vergelijken.",
    "Tabblad Partijen draagt elke partij van de betrokken leveringen, zodat te zien",
    "is welke het gat draagt. Een partij met aangevoerde stelen en nul boekingen",
    "is de meest voorkomende oorzaak.",
    "Voor de vergelijking regel voor regel met het document zelf: het werkboek van",
    "scripts/recon-salessheet-lines.ts.",
  ])
    regel(t);

  fs.mkdirSync(path.dirname(UIT), { recursive: true });
  await wb.xlsx.writeFile(UIT);
}

main()
  .catch((e) => {
    console.error("FOUT:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
