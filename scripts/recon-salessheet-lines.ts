/*
 * Legt elke sales sheet regel voor regel naast de portal en schrijft wat er
 * overblijft naar Excel.
 *
 * Waarom dit bestaat: de controle op nettoresultaat (`pdf-mismatch` in Data
 * Quality) vindt de leveringen die afwijken, maar zegt niet waar. Elke vondst van
 * de afgelopen week kwam van iemand die een partij uitklapte en de PDF ernaast
 * legde — een correctie die na het printen is geboekt, een hernummerde orderregel,
 * een verkoop die later landde. Dat handwerk doet dit script.
 *
 * De opbrengst is niet de lijst met verschillen; die is lang en grotendeels
 * verklaarbaar. De opbrengst is wat er ná de classificatie overblijft. Daarom
 * krijgt elk verschil een reden toegewezen, en is het tabblad dat ertoe doet dat
 * met de onverklaarde gevallen.
 *
 * Draaien:
 *   npx tsx scripts/recon-salessheet-lines.ts                 # hele archief
 *   npx tsx scripts/recon-salessheet-lines.ts --limit=200     # proefje
 *   npx tsx scripts/recon-salessheet-lines.ts --blob          # ook wat niet lokaal staat
 *
 * Opties:
 *   --limit=N       behandel hooguit N afrekeningen
 *   --blob          haal bestanden die niet in het archief staan uit de blobopslag
 *   --uit=PAD       waar het werkboek heen gaat
 *   --archief=PAD   wortelmap met PDF's. Standaard private_input/salessheets
 */
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/db";
import { parseSalesSheetLots, type SalesSheetLot } from "../src/lib/salessheet-pdf-lines";

function optie(vlag: string): string | undefined {
  const a = process.argv.slice(2).find((x) => x.startsWith(vlag + "="));
  return a ? a.slice(vlag.length + 1) : undefined;
}
const LIMIT = Number(optie("--limit") ?? 0) || Infinity;
const BLOB = process.argv.includes("--blob");
const ARCHIEF = optie("--archief") ?? path.join("private_input", "salessheets");
const UIT = optie("--uit") ?? path.join("private_input", "verzoening-regelniveau.xlsx");

/** Marge in stelen waaronder een verschil niet de moeite is. */
const STELEN_MARGE = 1;
/** Marge in euro waaronder een verschil afronding is. */
const BEDRAG_MARGE = 0.02;

/*
 * Welke regels onder een partij een verkoop zijn.
 *
 * Een afrekening zet naast de verkopen ook correcties in dezelfde tabel: een
 * doos die minder bevatte dan gemeld, een partij die het niet haalde, retour van
 * een klant. Die staan er met een eigen omschrijving en een bedrag van EUR 0,00,
 * en horen niet tegen een transactie te worden gelegd.
 *
 * Dit is een whitelist en geen lijst uitzonderingen, en dat is een bewuste keuze.
 * Gemeten over het hele archief (4.630 bladen, 46.922 partijen, 139.095 regels):
 * dertig verschillende omschrijvingen komen voor, waarvan er precies zes ooit een
 * bedrag dragen — "Direct sales" (72.198 regels), "VBA" (22.879), "FHN" (7.931),
 * "FHR" (5.025), "Production" (2.042) en "VPL" (1.537). De andere vierentwintig
 * staan samen 27.483 keer op een blad en dragen samen EUR 1,24, in twee regels
 * onder "Return to supplier". Een lijst uitzonderingen zou bij elke nieuwe
 * omschrijving stilzwijgend fout gaan; zo valt een onbekende omschrijving aan de
 * kant van de correcties, en komt het verschil naar boven als steelverschil in
 * plaats van als vervuiling in de bedragen.
 */
const VERKOOPKANALEN = new Set([
  "direct sales",
  "vba",
  "fhn",
  "fhr",
  "production",
  "vpl",
  // De Nederlandse opmaak, met dezelfde scheiding: over 3.086 regels dragen
  // "Directe verkopen", VBA, FHR, FHN, VPL en "Productie" een bedrag, en de
  // tweeëntwintig correctieomschrijvingen eronder geen enkele.
  "directe verkopen",
  "productie",
]);
function isCorrectieregel(kanaal: string): boolean {
  return !VERKOOPKANALEN.has(kanaal.trim().toLowerCase());
}

/*
 * Twee opmaken van de afrekening, en het onderscheid is niet cosmetisch.
 *
 * Op de gewone opmaak is de bedragkolom per regel de bruto-omzet; de kosten staan
 * eronder in een eigen blok en het nettoresultaat is de uitkomst. De portal houdt
 * hetzelfde aan, dus regel en transactie zijn direct vergelijkbaar.
 *
 * Er is een tweede opmaak — gemeten bij COLZFLXC — waar de kosten al per regel zijn
 * verrekend: 10.500 stelen "VBA" met bruto EUR 724,50 in de portal staat op de
 * afrekening als "(73,37)", want de veilingkosten zijn eraf. Zo'n blad heeft geen
 * kostenblok en drukt alleen "Total nett turnover" af, waardoor de kop-parser
 * omzet en netto op hetzelfde bedrag uitkomt. Dat is het kenmerk waaraan het te
 * herkennen is.
 *
 * Bedragen van zo'n blad naast de portal leggen levert alleen ruis op. De stelen
 * blijven wél vergelijkbaar: die zijn op beide opmaken bruto.
 */
type Variant = "bruto" | "netto" | "onbekend";

function bepaalVariant(
  regelsom: number,
  pdfOmzet: number | null,
  pdfKosten: number | null,
  pdfNetto: number | null,
  portalKosten: number
): Variant {
  /*
   * De netto-opmaak eerst, en dat is geen willekeurige volgorde. Op zo'n blad staat
   * geen bruto-omzet, dus leest de kop-parser hetzelfde getal als omzet én als
   * netto — en dan telt de regelsom vanzelf op tot die "omzet". Zou de brutotoets
   * voorgaan, dan zou elke netto-opmaak zichzelf als bruto aanwijzen. Gemeten op
   * COLSEMPC 128: regels EUR 27.579,55, printomzet EUR 27.579,55, portal-omzet
   * EUR 40.850,25 met EUR 13.270,72 aan kosten ertussen.
   *
   * Drie voorwaarden samen, want elk apart is te grof: geen kostenblok op het blad,
   * omzet en netto zijn hetzelfde getal, en de portal kent voor deze levering wél
   * kosten. Die laatste sluit de levering uit die eenvoudigweg geen kosten heeft.
   */
  if (
    pdfKosten === null &&
    pdfOmzet !== null &&
    pdfNetto !== null &&
    Math.abs(pdfOmzet - pdfNetto) <= BEDRAG_MARGE &&
    portalKosten > BEDRAG_MARGE
  )
    return "netto";
  if (pdfOmzet === null) return "onbekend";
  const marge = Math.max(1, Math.abs(pdfOmzet) * 0.005);
  if (Math.abs(regelsom - pdfOmzet) <= marge) return "bruto";
  return "onbekend";
}

/*
 * Een afrekening die niet is nagelopen. Die horen in het werkboek en niet alleen
 * in een regel op de console: een lijst verschillen zonder de bladen die niemand
 * heeft gelezen, leest als volledige dekking.
 */
type Overgeslagen = {
  leverancier: string;
  levering: string;
  leverdatum: string;
  reden: string;
  bestand: string;
};

type Bevinding = {
  leverancier: string;
  kweker: string;
  levering: string;
  onsFactuurnummer: string;
  leverdatum: string;
  factuurdatumPdf: string;
  partij: string;
  omschrijving: string;
  reden: string;
  pdfStelen: number | null;
  portalStelen: number | null;
  verschilStelen: number | null;
  pdfBedrag: number | null;
  portalBedrag: number | null;
  verschilBedrag: number | null;
  toelichting: string;
  opmaak: Variant;
  leveringPdfOmzet: number | null;
  leveringPortalOmzet: number | null;
  bestand: string;
};

async function tekstVan(buf: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  try {
    let t = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      t += c.items.map((x) => ("str" in x ? x.str : "")).join(" ") + "\n";
    }
    return t;
  } finally {
    await doc.destroy();
  }
}

function indexeerArchief(wortel: string): Map<string, string> {
  const uit = new Map<string, string>();
  const loop = (map: string) => {
    for (const item of fs.readdirSync(map, { withFileTypes: true })) {
      const pad = path.join(map, item.name);
      if (item.isDirectory()) loop(pad);
      else if (/\.pdf$/i.test(item.name)) uit.set(item.name.toLowerCase(), pad);
    }
  };
  loop(wortel);
  return uit;
}

/*
 * Twee partijen van dezelfde levering die elkaar precies opheffen.
 *
 * De ene mist wat de andere te veel heeft, op de steel en op de cent: de portal
 * heeft de verkoop onder de buurpartij gehangen. Gemeten op levering "cons 6"
 * (PCFFARCO): partij 3595811 komt 45.280 stelen en EUR 13.984,60 tekort en
 * 3595812 heeft precies dat te veel. Op leveringniveau valt het weg, dus de toets
 * op nettoresultaat ziet het nooit — maar een kweker die naar één partij kijkt,
 * ziet de verkeerde cijfers.
 *
 * Alleen tegen elkaar wegstrepen als het aan beide kanten exact klopt; een paar
 * dat alleen op de stelen sluit kan toeval zijn.
 */
function koppelVerwisselingen(bevindingen: Bevinding[]): void {
  const open = bevindingen.filter(
    (b) => b.reden === "onverklaard" && b.verschilStelen !== null && b.verschilBedrag !== null
  );
  const gepakt = new Set<Bevinding>();
  for (const a of open) {
    if (gepakt.has(a)) continue;
    const tegen = open.find(
      (b) =>
        b !== a &&
        !gepakt.has(b) &&
        Math.abs(a.verschilStelen! + b.verschilStelen!) <= STELEN_MARGE &&
        Math.abs(a.verschilBedrag! + b.verschilBedrag!) <= BEDRAG_MARGE &&
        Math.abs(a.verschilStelen!) > STELEN_MARGE
    );
    if (!tegen) continue;
    gepakt.add(a);
    gepakt.add(tegen);
    for (const [x, y] of [
      [a, tegen],
      [tegen, a],
    ] as const) {
      x.reden = "verkoop staat onder een andere partij van dezelfde levering";
      x.toelichting =
        `Partij ${y.partij} van dezelfde levering wijkt precies andersom af ` +
        `(${y.verschilStelen} stelen, EUR ${y.verschilBedrag!.toFixed(2)}). ` +
        `Samen komen de twee uit op nul, dus de levering als geheel klopt en alleen de verdeling over de partijen niet.`;
    }
  }
}

const datum = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const rond = (n: number) => Number(n.toFixed(2));

async function main() {
  if (!fs.existsSync(ARCHIEF)) {
    console.error(`Archief niet gevonden: ${ARCHIEF}`);
    process.exit(1);
  }
  const archief = indexeerArchief(ARCHIEF);
  console.log(`archief: ${archief.size} PDF's`);

  const sheets = await prisma.salesSheet.findMany({
    where: { pdfDocumentId: { not: null } },
    select: {
      id: true,
      invoiceNumber: true,
      ourInvoiceNumber: true,
      deliveryDate: true,
      pdfInvoiceDate: true,
      pdfTurnover: true,
      pdfCosts: true,
      pdfNetResult: true,
      totalTurnover: true,
      totalCosts: true,
      supplier: { select: { code: true, name: true } },
      pdfDocument: { select: { fileName: true, fileUrl: true } },
      lots: {
        select: {
          lotNumber: true,
          productName: true,
          grower: { select: { code: true, name: true } },
          transactions: {
            select: { date: true, salesType: true, stems: true, amount: true, bronFeitExtra: true },
          },
          corrections: { select: { correctionVolume: true, correctionDate: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });
  const teDoen = sheets.slice(0, LIMIT === Infinity ? sheets.length : LIMIT);
  console.log(`afrekeningen met een PDF: ${sheets.length}, ik doe er ${teDoen.length}\n`);

  const bevindingen: Bevinding[] = [];
  const overgeslagen: Overgeslagen[] = [];
  const perReden = new Map<string, number>();
  const perVariant = new Map<Variant, number>();
  let gelezen = 0,
    zonderBestand = 0,
    zonderPartijen = 0,
    partijenVergeleken = 0,
    partijenGelijk = 0;

  /*
   * De bevindingen van één afrekening blijven eerst bij elkaar. Een verschil op de
   * ene partij wordt soms verklaard door de partij ernaast, en dat is alleen te
   * zien als het hele blad er is; zie `koppelVerwisselingen`.
   */
  let vanDitBlad: Bevinding[] = [];
  const noteer = (b: Bevinding) => vanDitBlad.push(b);
  const sluitBlad = () => {
    koppelVerwisselingen(vanDitBlad);
    for (const b of vanDitBlad) {
      perReden.set(b.reden, (perReden.get(b.reden) ?? 0) + 1);
      bevindingen.push(b);
    }
    vanDitBlad = [];
  };

  for (const [i, ss] of teDoen.entries()) {
    const naam = ss.pdfDocument?.fileName ?? "";
    let buf: Buffer | null = null;
    const lokaal = archief.get(naam.toLowerCase());
    if (lokaal) buf = fs.readFileSync(lokaal);
    else if (BLOB && ss.pdfDocument?.fileUrl) {
      try {
        const r = await fetch(ss.pdfDocument.fileUrl);
        if (r.ok) buf = Buffer.from(await r.arrayBuffer());
      } catch {
        /* onbereikbaar */
      }
    }
    const kaal = {
      leverancier: ss.supplier.code,
      levering: String(ss.invoiceNumber),
      leverdatum: datum(ss.deliveryDate),
      bestand: naam,
    };
    if (!buf) {
      zonderBestand++;
      overgeslagen.push({ ...kaal, reden: BLOB ? "bestand niet te vinden" : "bestand staat niet in het archief" });
      continue;
    }

    let pdfLots: SalesSheetLot[];
    try {
      pdfLots = parseSalesSheetLots(await tekstVan(buf));
    } catch {
      zonderBestand++;
      overgeslagen.push({ ...kaal, reden: "PDF niet te lezen" });
      continue;
    }
    gelezen++;
    if (pdfLots.length === 0) {
      zonderPartijen++;
      overgeslagen.push({ ...kaal, reden: "geen partijtabel herkend in de PDF" });
      continue;
    }

    const pdfOmzet = ss.pdfTurnover === null ? null : Number(ss.pdfTurnover);
    const pdfKosten = ss.pdfCosts === null ? null : Number(ss.pdfCosts);
    const pdfNetto = ss.pdfNetResult === null ? null : Number(ss.pdfNetResult);
    const portalKosten = ss.totalCosts === null ? 0 : Number(ss.totalCosts);
    const regelsom = pdfLots.flatMap((l) => l.lines).reduce((s, r) => s + r.amount, 0);
    const opmaak = bepaalVariant(regelsom, pdfOmzet, pdfKosten, pdfNetto, portalKosten);
    perVariant.set(opmaak, (perVariant.get(opmaak) ?? 0) + 1);

    const basis = {
      leverancier: ss.supplier.code,
      levering: String(ss.invoiceNumber),
      onsFactuurnummer: ss.ourInvoiceNumber ?? "",
      leverdatum: datum(ss.deliveryDate),
      factuurdatumPdf: datum(ss.pdfInvoiceDate),
      opmaak,
      leveringPdfOmzet: pdfOmzet,
      leveringPortalOmzet: ss.totalTurnover === null ? null : rond(Number(ss.totalTurnover)),
      bestand: naam,
    };

    const portalPerNr = new Map(ss.lots.map((l) => [l.lotNumber, l]));

    for (const p of pdfLots) {
      const portal = portalPerNr.get(p.lotNumber);
      const kweker = portal?.grower?.code ?? p.growerCode ?? "";

      if (!portal) {
        noteer({
          ...basis,
          kweker,
          partij: p.lotNumber,
          omschrijving: p.description,
          reden: "partij ontbreekt in de portal",
          pdfStelen: p.deliveredStems,
          portalStelen: null,
          verschilStelen: null,
          pdfBedrag: rond(p.lines.reduce((s, l) => s + l.amount, 0)),
          portalBedrag: null,
          verschilBedrag: null,
          toelichting: "De afrekening noemt deze partij, de portal kent hem niet onder deze levering.",
        });
        continue;
      }

      partijenVergeleken++;

      // De verkoopregels van de PDF, zonder de correctieregels die met naam als
      // zodanig zijn afgedrukt.
      const pdfVerkoop = p.lines.filter((l) => !isCorrectieregel(l.channel));
      const pdfCorrectie = p.lines.filter((l) => isCorrectieregel(l.channel));
      const pdfStelen = pdfVerkoop.reduce((s, l) => s + l.stems, 0);
      const pdfBedrag = rond(pdfVerkoop.reduce((s, l) => s + l.amount, 0));

      /*
       * De portalkant telt álle boekingen op de partij, niet alleen die met
       * herkomst "origineel".
       *
       * Een orderregel die na het opmaken wordt bijgesteld, wordt in Fabric niet
       * overschreven maar tegengeboekt en opnieuw geboekt: partij 3695766 draagt
       * 1.260 stelen origineel, −1.260 tegen, en +900 opnieuw. Alleen "origineel"
       * tellen geeft 1.260 stelen en EUR 617,40, terwijl de afrekening 900 stelen
       * en EUR 441 afdrukt — precies het saldo over de drie. Op 3629997 net zo.
       *
       * Dat maakt ook het verschil dat we zóéken zichtbaar in plaats van onzichtbaar:
       * een correctie die ná het printen is geboekt zit wél in dit saldo en niet op
       * het blad, en komt daarmee naar boven als afwijking. Bij "origineel" tellen
       * zou juist die situatie perfect matchen.
       */
      const naCorrectie = portal.transactions.filter((t) => t.bronFeitExtra !== "origineel");
      const portalStelen = portal.transactions.reduce((s, t) => s + t.stems, 0);
      const portalBedrag = rond(portal.transactions.reduce((s, t) => s + Number(t.amount), 0));

      const dStelen = portalStelen - pdfStelen;
      // Op een netto-opmaak zijn de bedragen niet vergelijkbaar; alleen de stelen.
      const bedragTelt = opmaak !== "netto";
      const dBedrag = rond(portalBedrag - pdfBedrag);

      if (Math.abs(dStelen) <= STELEN_MARGE && (!bedragTelt || Math.abs(dBedrag) <= BEDRAG_MARGE)) {
        partijenGelijk++;
        continue;
      }

      /*
       * Classificeren. De volgorde is die van zekerheid: een verklaring die het
       * verschil op zowel stelen als bedrag exact dekt gaat voor een die alleen de
       * stelen verklaart, en die weer voor een die er enkel op lijkt.
       */
      let reden = "onverklaard";
      let toelichting = "";

      const corrBedrag = rond(naCorrectie.reduce((s, t) => s + Number(t.amount), 0));
      const corrStelen = naCorrectie.reduce((s, t) => s + t.stems, 0);
      const laatsteCorrectie = portal.corrections
        .map((c) => c.correctionDate)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const pdfCorrStelen = pdfCorrectie.reduce((s, l) => s + l.stems, 0);
      const bedragDekt = (n: number) =>
        !bedragTelt || Math.abs(n - dBedrag) <= Math.max(BEDRAG_MARGE, Math.abs(dBedrag) * 0.02);
      const stelenDekt = (n: number) => Math.abs(n - dStelen) <= STELEN_MARGE;

      if (portalStelen === 0 && pdfStelen > 0) {
        /*
         * De afrekening verkoopt de partij, de portal kent er geen enkele
         * transactie bij. Dat is geen interpretatieverschil maar ontbrekende data:
         * de orderregels zijn nooit binnengekomen, of ze zijn ingetrokken zonder
         * dat de nieuwe nummers zijn opgehaald.
         */
        reden = "partij heeft geen enkele transactie in de portal";
        toelichting = `De afrekening verkoopt ${pdfStelen} stelen voor EUR ${pdfBedrag.toFixed(2)}; de portal heeft voor deze partij niets staan.`;
      } else if (naCorrectie.length > 0 && stelenDekt(corrStelen) && bedragDekt(corrBedrag)) {
        /*
         * Het hele verschil zit in tegenboekingen op de orderregel. Twee gevallen,
         * en het onderscheid is niet cosmetisch: staat er op de afrekening een
         * regel die diezelfde stelen noemt, dan kennen beide kanten de correctie en
         * verschillen ze alleen over het geld — de afrekening drukt zo'n regel af
         * voor EUR 0,00 en laat de omzet staan, de portal haalt hem er wél af.
         * Gemeten op levering 2600593 (COLXLNFW): de afrekening telt EUR 3.909,90
         * omzet, de portal EUR 1.809,90, en de kweker is op de afrekening betaald.
         *
         * Staat zo'n regel er niet, dan is de orderregel bijgesteld nadat het blad
         * was gedrukt en heeft de kweker een afrekening die de portal inmiddels
         * tegenspreekt.
         */
        const raak = pdfCorrectie.find((l) => Math.abs(Math.abs(l.stems) - Math.abs(corrStelen)) <= STELEN_MARGE);
        if (raak) {
          reden = "afrekening haalt een retour niet van de omzet af, de portal wel";
          toelichting =
            `De afrekening zet ${raak.stems} stelen op ${raak.date} apart als "${raak.channel}" voor EUR 0,00 en laat de omzet staan. ` +
            `De portal boekt ze tegen: ${corrStelen} stelen en EUR ${corrBedrag.toFixed(2)}. ` +
            `Op de afrekening is de kweker over het hogere bedrag afgerekend.`;
        } else {
          reden = "orderregel bijgesteld na het printen van de afrekening";
          toelichting = `${naCorrectie.length} boeking(en) die de afrekening niet kent: ${corrStelen} stelen en EUR ${corrBedrag.toFixed(2)}${
            laatsteCorrectie ? `, laatste partijcorrectie ${datum(laatsteCorrectie)}` : ""
          }.`;
        }
      }

      if (reden === "onverklaard" && ss.pdfInvoiceDate) {
        const later = portal.transactions.filter((t) => t.date > ss.pdfInvoiceDate!);
        const laterBedrag = rond(later.reduce((s, t) => s + Number(t.amount), 0));
        const laterStelen = later.reduce((s, t) => s + t.stems, 0);
        if (later.length > 0 && stelenDekt(laterStelen) && bedragDekt(laterBedrag)) {
          reden = "verkoop geboekt na het printen van de afrekening";
          toelichting = `${later.length} boeking(en) van ná ${datum(ss.pdfInvoiceDate)}, samen ${laterStelen} stelen${
            bedragTelt ? ` en EUR ${laterBedrag.toFixed(2)}` : ""
          }.`;
        }
      }

      if (
        reden === "onverklaard" &&
        pdfCorrectie.length > 0 &&
        Math.abs(dStelen + pdfCorrStelen) <= STELEN_MARGE
      ) {
        /*
         * De afrekening drukt de correctie af als eigen regel; in de portal is het
         * geen transactie maar een partijcorrectie. Alleen op de stelen te zien,
         * want zo'n regel draagt op de afrekening geen bedrag.
         */
        reden = "partijcorrectie staat als eigen regel op de afrekening";
        toelichting = `De afrekening drukt ${pdfCorrectie.length} correctieregel(s) af (${pdfCorrectie
          .map((l) => `${l.channel} ${l.stems}`)
          .join(", ")}); in de portal is dat geen transactie maar een partijcorrectie.`;
      }

      if (
        reden === "onverklaard" &&
        laatsteCorrectie &&
        ss.pdfInvoiceDate &&
        laatsteCorrectie > ss.pdfInvoiceDate
      ) {
        reden = "partijcorrectie geboekt na de afrekening";
        toelichting = `Laatste partijcorrectie geboekt op ${datum(laatsteCorrectie)}, ná de factuurdatum ${datum(ss.pdfInvoiceDate)}.`;
      }

      noteer({
        ...basis,
        kweker,
        partij: p.lotNumber,
        omschrijving: portal.productName || p.description,
        reden,
        pdfStelen,
        portalStelen,
        verschilStelen: dStelen,
        pdfBedrag,
        portalBedrag,
        verschilBedrag: bedragTelt ? dBedrag : null,
        toelichting:
          (toelichting ||
            `Geen bekend patroon. Regels op de afrekening: ${p.lines
              .map((l) => `${l.date} ${l.channel} ${l.stems} st EUR ${l.amount.toFixed(2)}`)
              .join(" | ")}`) +
          (bedragTelt
            ? ""
            : ` — Let op: deze afrekening verrekent de kosten al per regel (levering: afrekening EUR ${
                pdfOmzet?.toFixed(2) ?? "?"
              }, portal EUR ${basis.leveringPortalOmzet?.toFixed(2) ?? "?"} bruto), dus alleen het steelverschil telt hier.`),
      });
    }

    sluitBlad();
    if ((i + 1) % 250 === 0) console.log(`  ${i + 1}/${teDoen.length}`);
  }

  console.log(`\ngelezen                : ${gelezen}`);
  console.log(`  bestand niet te lezen: ${zonderBestand}`);
  console.log(`  zonder partijtabel   : ${zonderPartijen}`);
  console.log(`opmaak                 : ${[...perVariant].map(([v, n]) => `${v} ${n}`).join(", ")}`);
  console.log(`partijen vergeleken    : ${partijenVergeleken}`);
  console.log(`  komt overeen         : ${partijenGelijk} (${((partijenGelijk / partijenVergeleken) * 100).toFixed(1)}%)`);
  console.log(`  wijkt af             : ${bevindingen.length}`);
  console.log(`\nnaar reden:`);
  for (const [r, n] of [...perReden].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${r}`);

  await schrijfWerkboek(bevindingen, overgeslagen, {
    gelezen,
    partijenVergeleken,
    partijenGelijk,
    zonderBestand,
    zonderPartijen,
    perReden,
    perVariant,
  });
  console.log(`\nwerkboek: ${UIT}`);
}

async function schrijfWerkboek(
  bevindingen: Bevinding[],
  overgeslagen: Overgeslagen[],
  stat: {
    gelezen: number;
    partijenVergeleken: number;
    partijenGelijk: number;
    zonderBestand: number;
    zonderPartijen: number;
    perReden: Map<string, number>;
    perVariant: Map<Variant, number>;
  }
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "growerportal";
  wb.created = new Date();

  const kolommen = [
    { header: "Leverancier", key: "leverancier", width: 12 },
    { header: "Kweker", key: "kweker", width: 12 },
    { header: "Levering", key: "levering", width: 18 },
    { header: "Ons factuurnr", key: "onsFactuurnummer", width: 14 },
    { header: "Leverdatum", key: "leverdatum", width: 12 },
    { header: "Factuurdatum PDF", key: "factuurdatumPdf", width: 16 },
    { header: "Partij", key: "partij", width: 11 },
    { header: "Product", key: "omschrijving", width: 32 },
    { header: "Reden", key: "reden", width: 40 },
    { header: "Stelen PDF", key: "pdfStelen", width: 11 },
    { header: "Stelen portal", key: "portalStelen", width: 12 },
    { header: "Verschil stelen", key: "verschilStelen", width: 14 },
    { header: "Bedrag PDF", key: "pdfBedrag", width: 12 },
    { header: "Bedrag portal", key: "portalBedrag", width: 13 },
    { header: "Verschil bedrag", key: "verschilBedrag", width: 14 },
    { header: "Opmaak afrekening", key: "opmaak", width: 16 },
    { header: "Levering omzet PDF", key: "leveringPdfOmzet", width: 17 },
    { header: "Levering omzet portal", key: "leveringPortalOmzet", width: 19 },
    { header: "Toelichting", key: "toelichting", width: 90 },
    { header: "Bestand", key: "bestand", width: 44 },
  ];

  const vulBlad = (naam: string, rijen: Bevinding[]) => {
    const ws = wb.addWorksheet(naam, { views: [{ state: "frozen", xSplit: 3, ySplit: 1 }] });
    ws.columns = kolommen;
    const kop = ws.getRow(1);
    kop.font = { bold: true };
    kop.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4EDE4" } };
    for (const b of rijen) ws.addRow(b);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolommen.length } };
    for (const k of ["pdfBedrag", "portalBedrag", "verschilBedrag", "leveringPdfOmzet", "leveringPortalOmzet"])
      ws.getColumn(k).numFmt = "#,##0.00";
    for (const k of ["pdfStelen", "portalStelen", "verschilStelen"]) ws.getColumn(k).numFmt = "#,##0";
    return ws;
  };

  const opBedrag = (a: Bevinding, b: Bevinding) =>
    Math.abs(b.verschilBedrag ?? 0) - Math.abs(a.verschilBedrag ?? 0) ||
    Math.abs(b.verschilStelen ?? 0) - Math.abs(a.verschilStelen ?? 0);

  // Het tabblad dat ertoe doet staat vooraan: wat in geen bekend patroon past.
  const onverklaard = bevindingen.filter((b) => b.reden === "onverklaard").sort(opBedrag);
  vulBlad("Onverklaard", onverklaard);
  vulBlad("Alle verschillen", [...bevindingen].sort(opBedrag));

  // Per leverancier, zodat een gesprek met één kweker in één regel te overzien is.
  const perLev = new Map<string, { n: number; onverklaard: number; stelen: number; bedrag: number }>();
  for (const b of bevindingen) {
    const k = perLev.get(b.leverancier) ?? { n: 0, onverklaard: 0, stelen: 0, bedrag: 0 };
    k.n++;
    if (b.reden === "onverklaard") k.onverklaard++;
    k.stelen += b.verschilStelen ?? 0;
    k.bedrag += b.verschilBedrag ?? 0;
    perLev.set(b.leverancier, k);
  }
  const lev = wb.addWorksheet("Per leverancier", { views: [{ state: "frozen", ySplit: 1 }] });
  lev.columns = [
    { header: "Leverancier", key: "code", width: 14 },
    { header: "Verschillen", key: "n", width: 12 },
    { header: "Onverklaard", key: "onverklaard", width: 13 },
    { header: "Verschil stelen", key: "stelen", width: 15 },
    { header: "Verschil bedrag", key: "bedrag", width: 15 },
  ];
  lev.getRow(1).font = { bold: true };
  lev.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4EDE4" } };
  for (const [code, k] of [...perLev].sort((a, b) => b[1].onverklaard - a[1].onverklaard || b[1].n - a[1].n))
    lev.addRow({ code, n: k.n, onverklaard: k.onverklaard, stelen: k.stelen, bedrag: rond(k.bedrag) });
  lev.getColumn("bedrag").numFmt = "#,##0.00";
  lev.getColumn("stelen").numFmt = "#,##0";

  const over = wb.addWorksheet("Niet nagelopen", { views: [{ state: "frozen", ySplit: 1 }] });
  over.columns = [
    { header: "Leverancier", key: "leverancier", width: 14 },
    { header: "Levering", key: "levering", width: 18 },
    { header: "Leverdatum", key: "leverdatum", width: 12 },
    { header: "Reden", key: "reden", width: 34 },
    { header: "Bestand", key: "bestand", width: 44 },
  ];
  over.getRow(1).font = { bold: true };
  over.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E8DC" } };
  for (const o of overgeslagen) over.addRow(o);
  over.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };

  const samen = wb.addWorksheet("Samenvatting");
  samen.columns = [
    { header: "", key: "a", width: 52 },
    { header: "", key: "b", width: 16 },
  ];
  const regel = (a: string, b: string | number = "") => samen.addRow({ a, b });
  regel("Verzoening sales sheet tegen portal, op regelniveau");
  regel("gedraaid op", new Date().toISOString().slice(0, 16).replace("T", " "));
  regel();
  regel("afrekeningen gelezen", stat.gelezen);
  regel("  bestand niet te lezen", stat.zonderBestand);
  regel("  zonder partijtabel in de PDF", stat.zonderPartijen);
  for (const [v, n] of stat.perVariant) regel(`  opmaak: ${v}`, n);
  regel("partijen vergeleken", stat.partijenVergeleken);
  regel("  komt overeen", stat.partijenGelijk);
  regel("  wijkt af", bevindingen.length);
  regel("  waarvan onverklaard", onverklaard.length);
  regel("afrekeningen niet nagelopen", overgeslagen.length);
  regel();
  regel("Naar reden");
  for (const [r, n] of [...stat.perReden].sort((a, b) => b[1] - a[1])) regel("  " + r, n);
  regel();
  regel("Hoe te lezen");
  for (const t of [
    "Stelen en bedragen uit de PDF tellen alleen de verkoopregels; regels als",
    "'Handling: less in box' zijn correcties en worden apart geteld.",
    "De portalkant telt alleen transacties met herkomst 'origineel', want dat is",
    "wat de afrekening als verkoop afdrukt.",
    "Verschil = portal min afrekening. Positief betekent: de portal telt meer.",
    "'Opmaak: netto' betekent dat de afrekening de kosten al per regel verrekent;",
    "daar zijn alleen de stelen vergelijkbaar en blijft het bedrag leeg.",
    "'Onverklaard' betekent: het verschil past in geen bekend patroon.",
    "Dat tabblad is waar naar gekeken moet worden.",
  ])
    regel(t);
  samen.getColumn("a").alignment = { wrapText: false };

  fs.mkdirSync(path.dirname(UIT), { recursive: true });
  await wb.xlsx.writeFile(UIT);
}

main()
  .catch((e) => {
    console.error("FOUT:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
