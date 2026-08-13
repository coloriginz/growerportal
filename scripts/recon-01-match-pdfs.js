/*
 * Stap 1 van de reconciliatie: koppel salessheet-PDF's aan de salessheets van
 * PCFUP en COLBFL in de portal.
 *
 * Matching gebeurt in twee lagen:
 *   1. op het salessheetnummer achter in de bestandsnaam (uniek, hoogste zekerheid)
 *   2. op het factuur-/containernummer vóór in de bestandsnaam
 *
 * Laag 2 is niet uniek — "C053 KLM Sat" komt meerdere keren per jaar voor. Daarom
 * wordt elke kandidaat geverifieerd door de Deliverydate uit de PDF te vergelijken
 * met de leverdatum in de portal. Alleen bij een exacte match telt de koppeling.
 */
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("../src/generated/prisma");
const prisma = new PrismaClient();

const PDF_ROOT = "private_input/salessheets";
const CODES = ["PCFUP", "COLBFL"];
const UIT = "private_input/recon-werklijst.json";

function verzamel(dir, uit = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) verzamel(p, uit);
    else if (/\.pdf$/i.test(e.name)) uit.push(p);
  }
  return uit;
}

const parseNL = (s) => {
  const m = String(s).match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m;
  y = Number(y); if (y < 100) y += 2000;
  return new Date(Date.UTC(y, Number(mo) - 1, Number(d)));
};

let getDocument;
const pdfCache = new Map();
async function leesPdfKop(bestand) {
  if (pdfCache.has(bestand)) return pdfCache.get(bestand);
  let uit = { lever: null, factuur: null, nummer: null };
  try {
    const doc = await getDocument({
      data: new Uint8Array(fs.readFileSync(bestand)), useSystemFonts: true, verbosity: 0,
    }).promise;
    const c = await (await doc.getPage(1)).getTextContent();
    const items = c.items.filter((i) => i.str.trim())
      .map((i) => ({ t: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));
    const naast = (label) => {
      const l = items.find((i) => new RegExp(label, "i").test(i.t));
      if (!l) return null;
      const r = items.filter((i) => Math.abs(i.y - l.y) <= 4 && i.x > l.x).sort((a, b) => a.x - b.x)[0];
      return r ? r.t : null;
    };
    uit = {
      lever: naast("Deliverydate"),
      factuur: naast("Invoice date"),
      nummer: naast("Invoice number"),
    };
    await doc.destroy();
  } catch { /* onleesbaar */ }
  pdfCache.set(bestand, uit);
  return uit;
}

(async () => {
  ({ getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs"));

  const pdfs = verzamel(PDF_ROOT);
  const opNummer = new Map();
  const opPrefix = new Map();
  for (const p of pdfs) {
    const b = path.basename(p, path.extname(p));
    const m = b.match(/^(.*)-(\d{5,7})$/);
    if (!m) continue;
    const [, pre, nr] = m;
    if (!opNummer.has(nr)) opNummer.set(nr, []);
    opNummer.get(nr).push(p);
    const k = pre.trim().toLowerCase();
    if (!opPrefix.has(k)) opPrefix.set(k, []);
    opPrefix.get(k).push(p);
  }
  console.log(`${pdfs.length} PDF's ingelezen\n`);

  const werklijst = [];
  for (const code of CODES) {
    const s = await prisma.supplier.findFirst({ where: { code }, select: { id: true, code: true, name: true, fabricId: true } });
    const sheets = await prisma.salesSheet.findMany({
      where: { supplierId: s.id },
      select: {
        invoiceNumber: true, ourInvoiceNumber: true, invoiceDate: true, deliveryDate: true,
        fabricParthdrId: true, totalTurnover: true, totalCosts: true, netResult: true,
        _count: { select: { lots: true, costs: true } },
      },
      orderBy: { invoiceDate: "desc" },
    });

    const telling = { nummer: 0, factnum: 0, geen: 0, afgewezen: 0 };

    for (const sh of sheets) {
      let pdf = null, wijze = null, kop = null;

      if (sh.ourInvoiceNumber && opNummer.has(sh.ourInvoiceNumber)) {
        pdf = opNummer.get(sh.ourInvoiceNumber)[0];
        wijze = "salessheetnummer";
        kop = await leesPdfKop(pdf);
        telling.nummer++;
      } else {
        const k = (sh.invoiceNumber || "").trim().toLowerCase();
        const kandidaten = k ? (opPrefix.get(k) || []) : [];
        const doel = sh.deliveryDate ? sh.deliveryDate.toISOString().slice(0, 10) : null;
        for (const kan of kandidaten) {
          const h = await leesPdfKop(kan);
          const d = h.lever ? parseNL(h.lever) : null;
          if (d && doel && d.toISOString().slice(0, 10) === doel) {
            pdf = kan; wijze = "factnum + leverdatum"; kop = h; telling.factnum++;
            break;
          }
        }
        if (!pdf) { if (kandidaten.length) telling.afgewezen++; else telling.geen++; }
      }

      werklijst.push({
        leverancier: code,
        rel_id: s.fabricId,
        parthdr_id: sh.fabricParthdrId,
        factnum: sh.invoiceNumber,
        salessheetnummer: sh.ourInvoiceNumber,
        portal_leverdatum: sh.deliveryDate ? sh.deliveryDate.toISOString().slice(0, 10) : null,
        portal_factuurdatum: sh.invoiceDate ? sh.invoiceDate.toISOString().slice(0, 10) : null,
        portal_omzet: Number(sh.totalTurnover),
        portal_kosten: Number(sh.totalCosts),
        portal_netto: Number(sh.netResult),
        lots: sh._count.lots,
        kostenregels: sh._count.costs,
        pdf: pdf ? pdf.replace(/\\/g, "/") : null,
        pdf_match: wijze,
        pdf_leverdatum: kop ? kop.lever : null,
        pdf_factuurdatum: kop ? kop.factuur : null,
        pdf_nummer: kop ? kop.nummer : null,
      });
    }

    console.log(`${code} — ${s.name}`);
    console.log(`  ${sheets.length} salessheets`);
    console.log(`  gekoppeld via salessheetnummer : ${telling.nummer}`);
    console.log(`  gekoppeld via factnum+leverdatum: ${telling.factnum}`);
    console.log(`  kandidaat gevonden maar datum wijkt af: ${telling.afgewezen}`);
    console.log(`  geen kandidaat: ${telling.geen}\n`);
  }

  fs.writeFileSync(UIT, JSON.stringify(werklijst, null, 1), "utf8");
  const metPdf = werklijst.filter((w) => w.pdf).length;
  console.log(`Werklijst weggeschreven: ${werklijst.length} salessheets, ${metPdf} met geverifieerde PDF -> ${UIT}`);

  await prisma.$disconnect();
})().catch(async (e) => { console.error("FOUT: " + e.stack); await prisma.$disconnect(); process.exit(1); });
