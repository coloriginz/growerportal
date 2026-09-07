/*
 * Zet elke afrekening waar de gedrukte kosten afwijken van de berekende in Excel.
 *
 * Aanleiding: de volledige kostenbackfill van 1 september 2026 — 58 leveranciers,
 * 244 kwartaalrondes, heel 2025 en 2026 — stelde EUR 0,00 bij. De kostenregels in
 * de portal komen dus regel voor regel overeen met Fabric, en het verschil met de
 * afrekening zit ergens anders. Dit werkboek is om te zien wáár.
 *
 * Drempel: één cent. Bewust lager dan de EUR 1 van de netto-controle, want die
 * controle vraagt "wijkt deze levering af" en dit werkboek vraagt "waar zit het".
 * Een verschil van centen over veel leveringen is een ander verhaal dan één van
 * honderden euro's, en dat onderscheid hoort zichtbaar te zijn in plaats van
 * weggefilterd. De kolom `Klasse` maakt het filterbaar.
 *
 * Draaien:
 *   npx tsx scripts/export-cost-differences.ts
 *   npx tsx scripts/export-cost-differences.ts --uit=pad/naar/bestand.xlsx
 *   npx tsx scripts/export-cost-differences.ts --drempel=1
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
const UIT = optie("--uit") ?? path.join("private_input", "kostenverschillen.xlsx");

/**
 * Hoe lang na levering een afrekening nog op zijn kostenregels mag wachten.
 *
 * Fabric levert de kostenregels weken na de levering aan; de afrekening wordt
 * eerder gedrukt. Een levering van vorige week zonder kosten in de portal is
 * daarom geen bevinding maar een wachtstand, en die hoort niet tussen de gevallen
 * die iemand moet uitzoeken. Gemeten: van de 32 leveringen met kosten op de PDF en
 * niets in de portal zijn er 28 van de laatste twee weken van augustus 2026 en
 * slechts 4 (samen EUR 103) ouder dan deze grens.
 */
const WACHTTIJD_DAGEN = 60;

const rond = (n: number) => Number(n.toFixed(2));
const datum = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

async function main() {
  const sheets = await prisma.salesSheet.findMany({
    where: { pdfCosts: { not: null } },
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
      costs: {
        select: { costCode: true, description: true, amount: true, salesSheetType: true, isInclusief: true },
        orderBy: { amount: "desc" },
      },
    },
    orderBy: { id: "asc" },
  });

  const grens = new Date(Date.now() - WACHTTIJD_DAGEN * 86400_000);
  type Rij = {
    leverancier: string;
    leveranciernaam: string;
    levering: string;
    onsFactuurnummer: string;
    leverdatum: string;
    factuurdatumPdf: string;
    kostenregels: number;
    kostenPortal: number;
    kostenPdf: number;
    verschilKosten: number;
    omzetPortal: number;
    omzetPdf: number | null;
    verschilOmzet: number | null;
    nettoPortal: number;
    nettoPdf: number | null;
    verschilNetto: number | null;
    klasse: string;
    beeld: string;
    verklaring: string;
    bestand: string;
  };

  const rijen: Rij[] = [];
  const regels: Record<string, string | number>[] = [];
  const perCode = new Map<string, { n: number; eur: number }>();

  for (const s of sheets) {
    const kostenPortal = Number(s.totalCosts);
    const kostenPdf = Number(s.pdfCosts);
    const d = rond(kostenPdf - kostenPortal);
    if (Math.abs(d) <= DREMPEL) continue;

    const omzetPdf = s.pdfTurnover === null ? null : Number(s.pdfTurnover);
    const nettoPdf = s.pdfNetResult === null ? null : Number(s.pdfNetResult);
    const omzetPortal = Number(s.totalTurnover);
    const dOmzet = omzetPdf === null ? null : rond(omzetPdf - omzetPortal);

    /*
     * Waar zit het verschil van deze levering: bij de kosten, bij de omzet, of bij
     * allebei. Dat onderscheid bepaalt of dit een kostenverhaal is of het verhaal
     * van de partijen en orderregels, en dat zijn twee verschillende onderzoeken.
     */
    const beeld =
      dOmzet === null
        ? "omzet niet uit de PDF gelezen"
        : Math.abs(dOmzet) <= 1
          ? "alleen de kosten"
          : "kosten én omzet";

    /*
     * Dekt precies één kostenregel het hele gat? Dan is dat de regel die de
     * afrekening niet afdrukt of anders berekent, en is het geval in één blik
     * afgehandeld. Eén procent speling, want de bedragen zijn onafgerond opgeslagen
     * en de afrekening telt ze pas aan het eind af.
     */
    const gat = Math.abs(d);
    const raak = s.costs.find((c) => Math.abs(Math.abs(Number(c.amount)) - gat) <= Math.max(0.02, gat * 0.01));

    const klasse =
      s.costs.length === 0 && s.deliveryDate >= grens
        ? "kostenregels nog onderweg"
        : s.costs.length === 0
          ? "geen kostenregels in de portal"
          : gat > 1
            ? "boven een euro"
            : "centen";

    if (raak) {
      const k = `${raak.costCode ?? "?"} — ${raak.description}`;
      const e = perCode.get(k) ?? { n: 0, eur: 0 };
      e.n++;
      e.eur += gat;
      perCode.set(k, e);
    }

    rijen.push({
      leverancier: s.supplier.code,
      leveranciernaam: s.supplier.name,
      levering: String(s.invoiceNumber),
      onsFactuurnummer: s.ourInvoiceNumber ?? "",
      leverdatum: datum(s.deliveryDate),
      factuurdatumPdf: datum(s.pdfInvoiceDate),
      kostenregels: s.costs.length,
      kostenPortal: rond(kostenPortal),
      kostenPdf: rond(kostenPdf),
      verschilKosten: d,
      omzetPortal: rond(omzetPortal),
      omzetPdf: omzetPdf === null ? null : rond(omzetPdf),
      verschilOmzet: dOmzet,
      nettoPortal: rond(Number(s.netResult)),
      nettoPdf: nettoPdf === null ? null : rond(nettoPdf),
      verschilNetto: nettoPdf === null ? null : rond(nettoPdf - Number(s.netResult)),
      klasse,
      beeld,
      verklaring: raak
        ? `Precies de regel "${raak.costCode ?? "?"} — ${raak.description}" van EUR ${rond(Number(raak.amount)).toFixed(2)}.`
        : s.costs.length === 0
          ? "De portal heeft voor deze levering nog geen enkele kostenregel."
          : "Niet aan één kostenregel toe te wijzen.",
      bestand: s.pdfDocument?.fileName ?? "",
    });

    for (const c of s.costs)
      regels.push({
        Leverancier: s.supplier.code,
        Levering: String(s.invoiceNumber),
        Leverdatum: datum(s.deliveryDate),
        Code: c.costCode ?? "",
        Omschrijving: c.description,
        Kant: c.salesSheetType ?? "",
        "All-in": c.isInclusief === null ? "" : c.isInclusief ? "ja" : "nee",
        Bedrag: rond(Number(c.amount)),
        "Verschil op de levering": d,
      });
  }

  console.log(`afrekeningen met gelezen kosten : ${sheets.length}`);
  console.log(`waarvan met een verschil > ${DREMPEL}: ${rijen.length}`);
  const perKlasse = new Map<string, number>();
  for (const r of rijen) perKlasse.set(r.klasse, (perKlasse.get(r.klasse) ?? 0) + 1);
  for (const [k, n] of [...perKlasse].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log(`som van de absolute verschillen : EUR ${rijen.reduce((s, r) => s + Math.abs(r.verschilKosten), 0).toFixed(2)}`);

  await schrijf(rijen, regels, perCode, sheets.length);
  console.log(`\nwerkboek: ${UIT}`);
}

async function schrijf(
  rijen: Record<string, unknown>[],
  regels: Record<string, string | number>[],
  perCode: Map<string, { n: number; eur: number }>,
  gelezen: number
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "growerportal";
  wb.created = new Date();
  const kop = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4EDE4" } };
  };

  const ws = wb.addWorksheet("Kostenverschillen", { views: [{ state: "frozen", xSplit: 3, ySplit: 1 }] });
  ws.columns = [
    { header: "Leverancier", key: "leverancier", width: 12 },
    { header: "Naam", key: "leveranciernaam", width: 26 },
    { header: "Levering", key: "levering", width: 18 },
    { header: "Ons factuurnr", key: "onsFactuurnummer", width: 14 },
    { header: "Leverdatum", key: "leverdatum", width: 12 },
    { header: "Factuurdatum PDF", key: "factuurdatumPdf", width: 16 },
    { header: "Kostenregels", key: "kostenregels", width: 13 },
    { header: "Kosten portal", key: "kostenPortal", width: 13 },
    { header: "Kosten PDF", key: "kostenPdf", width: 12 },
    { header: "Verschil kosten", key: "verschilKosten", width: 15 },
    { header: "Omzet portal", key: "omzetPortal", width: 13 },
    { header: "Omzet PDF", key: "omzetPdf", width: 12 },
    { header: "Verschil omzet", key: "verschilOmzet", width: 14 },
    { header: "Netto portal", key: "nettoPortal", width: 13 },
    { header: "Netto PDF", key: "nettoPdf", width: 12 },
    { header: "Verschil netto", key: "verschilNetto", width: 14 },
    { header: "Klasse", key: "klasse", width: 26 },
    { header: "Waar zit het", key: "beeld", width: 26 },
    { header: "Verklaring", key: "verklaring", width: 62 },
    { header: "Bestand", key: "bestand", width: 44 },
  ];
  kop(ws);
  for (const r of [...rijen].sort(
    (a, b) => Math.abs(b.verschilKosten as number) - Math.abs(a.verschilKosten as number)
  ))
    ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  for (const k of ["kostenPortal", "kostenPdf", "verschilKosten", "omzetPortal", "omzetPdf",
    "verschilOmzet", "nettoPortal", "nettoPdf", "verschilNetto"])
    ws.getColumn(k).numFmt = "#,##0.00";

  const wr = wb.addWorksheet("Kostenregels", { views: [{ state: "frozen", ySplit: 1 }] });
  wr.columns = [
    { header: "Leverancier", key: "Leverancier", width: 12 },
    { header: "Levering", key: "Levering", width: 18 },
    { header: "Leverdatum", key: "Leverdatum", width: 12 },
    { header: "Code", key: "Code", width: 11 },
    { header: "Omschrijving", key: "Omschrijving", width: 40 },
    { header: "Kant", key: "Kant", width: 6 },
    { header: "All-in", key: "All-in", width: 7 },
    { header: "Bedrag", key: "Bedrag", width: 12 },
    { header: "Verschil op de levering", key: "Verschil op de levering", width: 20 },
  ];
  kop(wr);
  for (const r of regels) wr.addRow(r);
  wr.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
  wr.getColumn("Bedrag").numFmt = "#,##0.00";
  wr.getColumn("Verschil op de levering").numFmt = "#,##0.00";

  const samen = wb.addWorksheet("Samenvatting");
  samen.columns = [
    { header: "", key: "a", width: 56 },
    { header: "", key: "b", width: 16 },
  ];
  const regel = (a: string, b: string | number = "") => samen.addRow({ a, b });
  regel("Kostenverschillen tussen de afrekening en de portal");
  regel("gedraaid op", new Date().toISOString().slice(0, 16).replace("T", " "));
  regel("drempel", `EUR ${DREMPEL}`);
  regel();
  regel("afrekeningen waarvan de kosten uit de PDF zijn gelezen", gelezen);
  regel("waarvan met een verschil", rijen.length);
  regel("som van de absolute verschillen", rond(rijen.reduce((s, r) => s + Math.abs(r.verschilKosten as number), 0)));
  regel();
  regel("Naar klasse");
  const perKlasse = new Map<string, number>();
  for (const r of rijen) perKlasse.set(r.klasse as string, (perKlasse.get(r.klasse as string) ?? 0) + 1);
  for (const [k, n] of [...perKlasse].sort((a, b) => b[1] - a[1])) regel("  " + k, n);
  regel();
  regel("Verschillen die precies één kostenregel groot zijn");
  for (const [k, v] of [...perCode].sort((a, b) => b[1].n - a[1].n)) regel(`  ${v.n}x  ${k}`, rond(v.eur));
  regel();
  regel("Hoe te lezen");
  for (const t of [
    "Verschil is altijd PDF min portal. Positief betekent: de afrekening drukt",
    "meer kosten af dan de portal berekent.",
    "De kostenregels in de portal komen regel voor regel overeen met Fabric —",
    "gemeten met een volledige backfill over 244 kwartalen, die EUR 0,00 bijstelde.",
    "Het verschil zit dus tussen Fabric en het gedrukte document, niet tussen",
    "Fabric en de portal.",
    "'kostenregels nog onderweg' betekent: geleverd binnen de laatste 60 dagen en",
    "de kostenregels staan nog niet in Fabric. Dat lost zichzelf op.",
    "Kolom 'Waar zit het' scheidt de kostenverhalen van de gevallen waar ook de",
    "omzet afwijkt — dat laatste is het verhaal van de partijen en orderregels.",
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
