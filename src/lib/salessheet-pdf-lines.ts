/*
 * De regels per partij zoals ze op de sales sheet staan.
 *
 * `salessheet-pdf-parser.ts` leest de kop en de totalen van een afrekening. Deze
 * module leest de tabel eronder: per partij het aangevoerde aantal, de kweker, en
 * de verkoopregels met datum, kanaal, prijs en bedrag.
 *
 * Waarom apart: de vergelijking op nettoresultaat vindt wél dat een levering
 * afwijkt, maar niet waar. Elke vondst van de afgelopen week — een correctie die
 * na het printen is geboekt, een hernummerde orderregel, een verkoop die later
 * landde — kwam van iemand die de regels naast elkaar legde. Dat handwerk is wat
 * hier wordt overgenomen.
 *
 * Twee kenmerken maken de tekst leesbaar nadat pdfjs hem heeft platgeslagen:
 * een prijs draagt altijd drie decimalen en een bedrag altijd twee. Daarmee is
 * het einde van een regel te herkennen zonder op posities te hoeven vertrouwen,
 * en posities zijn precies wat er wegvalt zodra een lay-out verandert.
 */

/** Eén verkoop- of correctieregel onder een partij. */
export type SalesSheetLine = {
  /** "2026-08-13" */
  date: string;
  /** "Direct sales", "VBA", "FHN", "Handling: quality", ... */
  channel: string;
  stems: number;
  price: number;
  amount: number;
};

export type SalesSheetLot = {
  lotNumber: string;
  /** De kwekercode zoals de afrekening hem afdrukt, bijvoorbeeld "COLANTAL". */
  growerCode: string | null;
  colli: number | null;
  /** Stelen per collo, uit "2 X 400". */
  stemsPerColli: number | null;
  /** Productnaam met de sorteringen erachter, zoals afgedrukt. */
  description: string;
  /** Het aangevoerde aantal uit de kopregel. */
  deliveredStems: number | null;
  /** De gemiddelde prijs uit de kopregel — die deelt door aangevoerd, niet door verkocht. */
  averagePrice: number | null;
  lines: SalesSheetLine[];
};

/** "1.763,10" en "(€ 193,78)" naar een getal. Haakjes betekenen negatief. */
function leesBedrag(ruw: string): number | null {
  const negatief = ruw.includes("(");
  const schoon = ruw.replace(/[()€\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(schoon);
  if (!Number.isFinite(n)) return null;
  return negatief ? -Math.abs(n) : n;
}

/** "25-01-2025" naar "2025-01-25". Geeft null bij een onmogelijke datum. */
function leesDatum(ruw: string): string | null {
  const m = ruw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const dag = Number(m[1]);
  const maand = Number(m[2]);
  if (maand < 1 || maand > 12 || dag < 1 || dag > 31) return null;
  return `${m[3]}-${String(maand).padStart(2, "0")}-${String(dag).padStart(2, "0")}`;
}

/*
 * De kopregel van een partij:
 *
 *   Lot 3582078 2 X 400 Dianthus Br Amazon Neon Purple 55 0,154 800 COLANTAL 23
 *
 * Nederlandse leveranciers krijgen hetzelfde blad in het Nederlands, met "Partij"
 * waar het Engelse "Lot" staat. Verder is de opbouw gelijk. Zonder dat woord erbij
 * bleven 398 van de 4.041 afrekeningen ongelezen, vrijwel allemaal van COLXGREE
 * en COLXTOG2.
 *
 * De omschrijving draagt de sorteringen als losse getallen ("... Purple 55",
 * "... Glory 70 20"), dus die zijn niet van de omschrijving te scheiden zonder te
 * gokken hoeveel het er zijn. Ze blijven daarom staan zoals afgedrukt: voor het
 * terugvinden van een partij is de omschrijving genoeg, en het partijnummer is de
 * echte sleutel.
 *
 * De gemiddelde prijs mag negatief zijn, en dat minteken is niet optioneel om te
 * herkennen: een partij waarvan de veilingkosten de opbrengst overtreffen drukt
 * "-0,022" af. Zonder het teken slaat de kop over naar het volgende getal met drie
 * decimalen — de prijs van de vólgende partij — waarmee twee partijen tot één blok
 * versmelten en er eentje uit de uitkomst verdwijnt. Gemeten op 102115-396161.pdf:
 * partij 3858159 kreeg zo het aangevoerde aantal en de regels van 3858160, en
 * 3858160 zelf kwam er niet uit.
 */
const KOP = new RegExp(
  String.raw`(?:Lot|Partij)\s+(\d+)\s+(\d+)\s*[Xx]\s*([\d.]+)\s+(.+?)\s+(-?[\d.]*,\d{3})\s+([\d.]+)\s+([A-Z][A-Z0-9]{2,})\b`,
  "g"
);

/*
 * Een regel onder een partij:
 *
 *   300 27-01-2025 Direct sales 0,185 55,50
 *
 * Het aantal staat vóór de datum en het kanaal ertussenin. Drie decimalen voor de
 * prijs, twee voor het bedrag — dat onderscheid draagt de hele herkenning.
 *
 * Het kanaal mag geen cijfer bevatten. Dat is geen kosmetische eis: bij een levering
 * over meerdere bladen staat de factuurkop boven aan elk blad, met daarin de
 * leverdatum. Zonder die eis begint een match in die kop en rekt hij door tot de
 * prijs van de eerste échte regel eronder — waarmee die regel wordt opgeslokt en
 * stelen verdwijnen. De kop staat vol nummers (AWB, VAT, factuurnummer), de kanalen
 * dragen er geen enkele: "Direct sales", "VBA", "Handling: less in box",
 * "z: Less than invoice". Dat verschil is de scheiding.
 */
const REGEL = new RegExp(
  String.raw`(-?[\d.]+)\s+(\d{1,2}-\d{1,2}-\d{4})\s+([^\d
]{1,45}?)\s+(-?[\d.]*,\d{3})\s+(\(?-?[\d.]*,\d{2}\)?)`,
  "g"
);

/**
 * Leest de partijen en hun regels uit de platte tekst van een sales sheet.
 *
 * De tekst is die van álle pagina's aan elkaar: bij een levering met veel partijen
 * loopt de tabel door over meerdere bladen, en een partij kan daarbij midden in
 * worden afgebroken.
 */
export function parseSalesSheetLots(text: string): SalesSheetLot[] {
  const koppen: { index: number; lengte: number; m: RegExpExecArray }[] = [];
  KOP.lastIndex = 0;
  for (let m = KOP.exec(text); m !== null; m = KOP.exec(text)) {
    koppen.push({ index: m.index, lengte: m[0].length, m });
  }

  const lots: SalesSheetLot[] = [];
  for (const [i, kop] of koppen.entries()) {
    const m = kop.m;
    // Het blok loopt tot de volgende partij, of tot het einde van de tekst.
    const vanaf = kop.index + kop.lengte;
    const tot = i + 1 < koppen.length ? koppen[i + 1].index : text.length;
    const blok = text.slice(vanaf, tot);

    const lines: SalesSheetLine[] = [];
    REGEL.lastIndex = 0;
    for (let r = REGEL.exec(blok); r !== null; r = REGEL.exec(blok)) {
      const datum = leesDatum(r[2]);
      const stems = leesBedrag(r[1]);
      const price = leesBedrag(r[4]);
      const amount = leesBedrag(r[5]);
      if (datum === null || stems === null || price === null || amount === null) continue;
      lines.push({ date: datum, channel: r[3].trim(), stems, price, amount });
    }

    lots.push({
      lotNumber: m[1],
      colli: leesBedrag(m[2]),
      stemsPerColli: leesBedrag(m[3]),
      description: m[4].trim(),
      averagePrice: leesBedrag(m[5]),
      deliveredStems: leesBedrag(m[6]),
      growerCode: m[7] ?? null,
      lines,
    });
  }
  return lots;
}
