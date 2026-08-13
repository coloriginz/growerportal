/*
 * Stap 13: kostenreconciliatie in drie kolommen — portal (augustus), salessheet-PDF,
 * en de huidige berekende waarde in Fabric (marts.fct_salesheets_costs).
 *
 * Doel: vaststellen of de kostenverschillen uit de reconciliatie van augustus 2026
 * nog bestaan, en zo ja waar ze zitten.
 *
 * Bronnen:
 *   private_input/recon-schoon.json         234 salessheets met geverifieerde PDF
 *   private_input/recon-pdf-data.json       kostenregels zoals op de PDF
 *   private_input/recon-fabric-kosten.json  berekende kosten uit de transformlaag
 *   portaldatabase                          SalesSheetCost (huidige import)
 *
 * Uitvoer: private_input/Kostenreconciliatie PCFUP en COLBFL.xlsx
 */
const fs = require("fs");
const ExcelJS = require("exceljs");
const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ quiet: true });

const sql = neon(process.env.DATABASE_URL);
const UIT = "private_input/Kostenreconciliatie PCFUP en COLBFL.xlsx";
const n = (x) => (x === null || x === undefined || x === "" ? 0 : Number(x));
const r2 = (x) => Math.round(x * 100) / 100;

const schoon = JSON.parse(fs.readFileSync("private_input/recon-schoon.json", "utf8"));
const pdfData = JSON.parse(fs.readFileSync("private_input/recon-pdf-data.json", "utf8"));
const fabric = JSON.parse(fs.readFileSync("private_input/recon-fabric-kosten.json", "utf8"));

const pdfByHdr = new Map(pdfData.map((p) => [String(p.parthdr_id), p]));

/*
 * De PDF is Engels, KBT Nederlands. Twee PDF-regels vatten elk twee KBT-kostensoorten
 * samen; die staan als array.
 */
const KOPPEL = {
  "Handling charges": "Verwerkingskosten",
  "Commission direct sales": "Commissie directe verkoop",
  "Commission auction": "Veilingprovisie",
  "Commission auction sales": "Commissie veilingverkoop",
  "Distribution Costs": "Distributiekosten",
  "Transaction levy": "Transactie heffing",
  "Trolley levy": "Karheffing",
  "Lot levy": "Partijheffing",
  "Financing and debtors insurance": "Finance en debiteuren verzekering",
  "Customers Clearing": "Inklaren / aangifte",
  "Clearing & Logistics Surcharge Airport": "Afhandelingskosten afhandelaar - variabel tarief",
  "Additional handling charges": "Verwerkingskosten extra",
  "Admin./Price information": "Prijsinformatie en Admin. kosten",
  "Handling charges Coloriginz": "Verwerkingskosten Coloriginz",
  "Freight costs Holland": "Vrachtkosten Nederland",
  "Import duties": "Invoerrechten",
  Others: "Diversen",
  "Transport costs": "Transportkosten",
  Documents: "Documenten",
  "Service charge + BBH levy": "Service charge + BBH levy",
  "Waste tax": "Waste tax",
  "Additional Declaration": "Additional Declaration",
  "Container rental": ["Fusthuur Directe Verkopen", "Fusthuur Aanvoer Orders"],
  "Clearing & Logistics": ["Afhandelingskst. lokatie vertrek", "Afhandelingskst. lokatie aankomst"],
};
const nlNaarEn = new Map();
for (const [en, nl] of Object.entries(KOPPEL)) for (const x of [].concat(nl)) nlNaarEn.set(x, en);
const naarCategorie = (nlNaam) => nlNaarEn.get((nlNaam || "").trim()) || `?? ${nlNaam}`;

// percentageregels (salesheet_type VE) tegenover vaste bedragen (IN)
const typePerKost = new Map();
for (const f of fabric) if (!typePerKost.has(f.kost_naam)) typePerKost.set(f.kost_naam, f.salesheet_type);

async function main() {
  const ids = schoon.map((s) => String(s.parthdr));
  const portalRows = await sql`
    SELECT s."fabricParthdrId" AS parthdr, c."fabricShkostId" AS shkost, c.description,
           c.amount, c."costTypeCode", s."updatedAt"
    FROM   "SalesSheetCost" c
    JOIN   "SalesSheet" s ON s.id = c."salesSheetId"
    WHERE  s."fabricParthdrId" = ANY(${ids})
  `;
  console.log(`portal ${portalRows.length} kostenregels | fabric ${fabric.length} | 234 salessheets`);

  const idx = (arr, key) => {
    const m = new Map();
    for (const x of arr) {
      const k = String(key(x));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  };
  const portalByHdr = idx(portalRows, (r) => r.parthdr);
  const fabricByHdr = idx(fabric, (f) => f.parthdr_id);

  // ---------- regelniveau, gegroepeerd op PDF-categorie ----------
  const regels = [];
  const sheets = [];
  for (const s of schoon) {
    const id = String(s.parthdr);
    const pdf = pdfByHdr.get(id);
    const pRows = portalByHdr.get(id) || [];
    const fRows = fabricByHdr.get(id) || [];

    const cats = new Map();
    const bump = (cat, veld, bedrag, naam) => {
      const e = cats.get(cat) || { cat, pdf: 0, portal: 0, fabric: 0, nl: new Set() };
      e[veld] += bedrag;
      if (naam) e.nl.add(naam);
      cats.set(cat, e);
    };
    for (const k of pdf?.kostregels || []) bump(k.omschrijving.trim(), "pdf", n(k.bedrag));
    for (const p of pRows) bump(naarCategorie(p.description), "portal", n(p.amount), (p.description || "").trim());
    for (const f of fRows) bump(naarCategorie(f.kost_naam), "fabric", n(f.salesheet_amount), (f.kost_naam || "").trim());

    let tPdf = 0;
    let tPortal = 0;
    let tFabric = 0;
    for (const e of cats.values()) {
      tPdf += e.pdf;
      tPortal += e.portal;
      tFabric += e.fabric;
      regels.push({
        leverancier: s.lev,
        parthdr: s.parthdr,
        factuur: s.factnum,
        leverdatum: s.leverdatum,
        kostensoort_pdf: e.cat,
        kostensoort_kbt: [...e.nl].join(" + "),
        soort: typePerKost.get([...e.nl][0]) === "VE" ? "percentage" : "bedrag",
        pdf: r2(e.pdf),
        portal: r2(e.portal),
        fabric: r2(e.fabric),
        d_portal_pdf: r2(e.portal - e.pdf),
        d_fabric_pdf: r2(e.fabric - e.pdf),
        d_fabric_portal: r2(e.fabric - e.portal),
      });
    }

    sheets.push({
      leverancier: s.lev,
      parthdr: s.parthdr,
      factuur: s.factnum,
      leverdatum: s.leverdatum,
      pdf_kosten: r2(n(s.pdf_kosten)),
      portal_augustus: r2(n(s.portal_kosten)),
      portal_nu: r2(tPortal),
      fabric_nu: r2(tFabric),
      pdf_regels: (pdf?.kostregels || []).length,
      portal_regels: pRows.length,
      fabric_regels: fRows.length,
      d_portal_pdf: r2(tPortal - n(s.pdf_kosten)),
      d_fabric_pdf: r2(tFabric - n(s.pdf_kosten)),
      d_fabric_portal: r2(tFabric - tPortal),
      d_portal_toen_nu: r2(tPortal - n(s.portal_kosten)),
    });
  }

  // ---------- per kostensoort ----------
  const perSoort = new Map();
  for (const r of regels) {
    const e = perSoort.get(r.kostensoort_pdf) || {
      kostensoort_pdf: r.kostensoort_pdf,
      kostensoort_kbt: r.kostensoort_kbt,
      soort: r.soort,
      salessheets: 0,
      pdf: 0,
      portal: 0,
      fabric: 0,
      afw_portal: 0,
      afw_fabric: 0,
    };
    e.salessheets++;
    e.pdf += r.pdf;
    e.portal += r.portal;
    e.fabric += r.fabric;
    if (Math.abs(r.d_portal_pdf) >= 1) e.afw_portal++;
    if (Math.abs(r.d_fabric_pdf) >= 1) e.afw_fabric++;
    if (!e.kostensoort_kbt && r.kostensoort_kbt) e.kostensoort_kbt = r.kostensoort_kbt;
    perSoort.set(r.kostensoort_pdf, e);
  }
  const soorten = [...perSoort.values()]
    .map((e) => ({ ...e, pdf: r2(e.pdf), portal: r2(e.portal), fabric: r2(e.fabric), d_portal_pdf: r2(e.portal - e.pdf), d_fabric_pdf: r2(e.fabric - e.pdf), d_fabric_portal: r2(e.fabric - e.portal) }))
    .sort((a, b) => Math.abs(b.d_fabric_pdf) - Math.abs(a.d_fabric_pdf));

  // ---------- consoleoverzicht ----------
  const tel = (arr, veld, tol) => arr.filter((x) => Math.abs(x[veld]) < tol).length;
  console.log("\n=== Totalen over 234 salessheets ===");
  for (const lev of ["PCFUP", "COLBFL"]) {
    const sub = sheets.filter((s) => s.leverancier === lev);
    const som = (v) => r2(sub.reduce((a, x) => a + x[v], 0));
    console.log(
      `${lev}: PDF ${som("pdf_kosten")} | portal aug ${som("portal_augustus")} | portal nu ${som("portal_nu")} | fabric nu ${som("fabric_nu")}`
    );
    console.log(
      `        binnen EUR 1 van PDF -> portal ${tel(sub, "d_portal_pdf", 1)}/${sub.length}, fabric ${tel(sub, "d_fabric_pdf", 1)}/${sub.length}` +
        ` | fabric = portal: ${tel(sub, "d_fabric_portal", 0.01)}/${sub.length}`
    );
  }
  console.log("\n=== Per kostensoort: verschil met de PDF ===");
  for (const s of soorten.slice(0, 12)) {
    console.log(
      `${s.kostensoort_pdf.slice(0, 38).padEnd(38)} ${s.soort.padEnd(10)} PDF ${String(s.pdf).padStart(10)} | portal ${String(s.portal).padStart(10)} (${s.afw_portal}x afw) | fabric ${String(s.fabric).padStart(10)} (${s.afw_fabric}x afw)`
    );
  }

  // ---------- Excel ----------
  const C = { donker: "FF1F3864", grijs: "FFF2F2F2", groen: "FFC6EFCE", groenT: "FF006100", rood: "FFFFC7CE", roodT: "FF9C0006", amber: "FFFFEB9C", amberT: "FF9C6500" };
  const wb = new ExcelJS.Workbook();
  wb.creator = "Grower Portal";
  wb.created = new Date();

  const maakBlad = (naam, kolommen, rijen, opties = {}) => {
    const ws = wb.addWorksheet(naam, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = kolommen;
    ws.addRows(rijen);
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.donker } };
    ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolommen.length } };
    for (const key of opties.markeer || []) {
      const kol = ws.getColumn(key);
      kol.eachCell({ includeEmpty: false }, (cel, rij) => {
        if (rij === 1) return;
        const v = Number(cel.value);
        if (!Number.isFinite(v)) return;
        const abs = Math.abs(v);
        const kleur = abs < 1 ? [C.groen, C.groenT] : abs < 10 ? [C.amber, C.amberT] : [C.rood, C.roodT];
        cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: kleur[0] } };
        cel.font = { color: { argb: kleur[1] } };
      });
    }
    return ws;
  };

  const geld = "#,##0.00";
  maakBlad(
    "Per salessheet",
    [
      { header: "Leverancier", key: "leverancier", width: 11 },
      { header: "parthdr_id", key: "parthdr", width: 11 },
      { header: "Factuur", key: "factuur", width: 16 },
      { header: "Leverdatum", key: "leverdatum", width: 12 },
      { header: "Kosten op PDF", key: "pdf_kosten", width: 14, style: { numFmt: geld } },
      { header: "Portal augustus", key: "portal_augustus", width: 14, style: { numFmt: geld } },
      { header: "Portal nu", key: "portal_nu", width: 14, style: { numFmt: geld } },
      { header: "Fabric nu (berekend)", key: "fabric_nu", width: 16, style: { numFmt: geld } },
      { header: "Portal - PDF", key: "d_portal_pdf", width: 13, style: { numFmt: geld } },
      { header: "Fabric - PDF", key: "d_fabric_pdf", width: 13, style: { numFmt: geld } },
      { header: "Fabric - Portal", key: "d_fabric_portal", width: 14, style: { numFmt: geld } },
      { header: "Portal nu - augustus", key: "d_portal_toen_nu", width: 16, style: { numFmt: geld } },
      { header: "# regels PDF", key: "pdf_regels", width: 11 },
      { header: "# regels portal", key: "portal_regels", width: 12 },
      { header: "# regels Fabric", key: "fabric_regels", width: 12 },
    ],
    sheets.sort((a, b) => Math.abs(b.d_fabric_pdf) - Math.abs(a.d_fabric_pdf)),
    { markeer: ["d_portal_pdf", "d_fabric_pdf", "d_fabric_portal", "d_portal_toen_nu"] }
  );

  maakBlad(
    "Per kostenregel",
    [
      { header: "Leverancier", key: "leverancier", width: 11 },
      { header: "parthdr_id", key: "parthdr", width: 11 },
      { header: "Factuur", key: "factuur", width: 16 },
      { header: "Leverdatum", key: "leverdatum", width: 12 },
      { header: "Kostensoort (PDF)", key: "kostensoort_pdf", width: 34 },
      { header: "Kostensoort (KBT)", key: "kostensoort_kbt", width: 34 },
      { header: "Type", key: "soort", width: 11 },
      { header: "PDF", key: "pdf", width: 12, style: { numFmt: geld } },
      { header: "Portal", key: "portal", width: 12, style: { numFmt: geld } },
      { header: "Fabric nu", key: "fabric", width: 12, style: { numFmt: geld } },
      { header: "Portal - PDF", key: "d_portal_pdf", width: 13, style: { numFmt: geld } },
      { header: "Fabric - PDF", key: "d_fabric_pdf", width: 13, style: { numFmt: geld } },
      { header: "Fabric - Portal", key: "d_fabric_portal", width: 14, style: { numFmt: geld } },
    ],
    regels.sort((a, b) => Math.abs(b.d_fabric_pdf) - Math.abs(a.d_fabric_pdf)),
    { markeer: ["d_portal_pdf", "d_fabric_pdf", "d_fabric_portal"] }
  );

  maakBlad(
    "Per kostensoort",
    [
      { header: "Kostensoort (PDF)", key: "kostensoort_pdf", width: 36 },
      { header: "Kostensoort (KBT)", key: "kostensoort_kbt", width: 36 },
      { header: "Type", key: "soort", width: 11 },
      { header: "# salessheets", key: "salessheets", width: 13 },
      { header: "PDF", key: "pdf", width: 14, style: { numFmt: geld } },
      { header: "Portal", key: "portal", width: 14, style: { numFmt: geld } },
      { header: "Fabric nu", key: "fabric", width: 14, style: { numFmt: geld } },
      { header: "Portal - PDF", key: "d_portal_pdf", width: 13, style: { numFmt: geld } },
      { header: "Fabric - PDF", key: "d_fabric_pdf", width: 13, style: { numFmt: geld } },
      { header: "Fabric - Portal", key: "d_fabric_portal", width: 14, style: { numFmt: geld } },
      { header: "# sheets portal wijkt af", key: "afw_portal", width: 15 },
      { header: "# sheets Fabric wijkt af", key: "afw_fabric", width: 15 },
    ],
    soorten,
    { markeer: ["d_portal_pdf", "d_fabric_pdf", "d_fabric_portal"] }
  );

  await wb.xlsx.writeFile(UIT);
  console.log(`\nWeggeschreven naar ${UIT}`);
  fs.writeFileSync("private_input/recon-kosten-drieweg.json", JSON.stringify({ sheets, regels, soorten }, null, 1), "utf8");
}

main().catch((e) => {
  console.error("FOUT: " + e.message);
  process.exit(1);
});
