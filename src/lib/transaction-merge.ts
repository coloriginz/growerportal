/**
 * Van losse orderregels naar de regels zoals de afrekening ze toont.
 *
 * De portal bewaart wat Fabric levert: één rij per boeking. De sales sheet drukt
 * iets anders af — per dag en per kanaal één regel, met de correcties eronder.
 * Deze functie doet die vertaling, en ze staat hier apart in plaats van in het
 * scherm zodat `scripts/checks/transaction-merge.ts` haar kan natrekken. Dat is
 * niet theoretisch: de vorige versie liet stilzwijgend regels vallen (zie
 * hieronder bij pass 1) en niets ving dat op.
 */

/** Kanalen die de afrekening onder "Direct Sales" samenneemt. */
const DIRECT_TYPES = new Set(["Persoonlijk", "VMP", "Aurora"]);

export function channelLabel(salesType: string): string {
  return DIRECT_TYPES.has(salesType) ? "Direct Sales" : salesType;
}

export interface MergeableTransaction {
  id: string;
  fabricOrdregId: number | null;
  date: string;
  salesType: string;
  stems: number;
  pricePerStem: string;
  amount: string;
  bronFeitExtra: string;
  correctionReasonId: number | null;
}

export interface MergedTransaction {
  id: string;
  date: string;
  salesType: string;
  stems: number;
  amount: number;
  pricePerStem: number;
  hasCorrection: boolean;
  correctionReasonId: number | null;
}

const prijs = (stems: number, amount: number) => (stems !== 0 ? amount / stems : 0);

/**
 * Twee stappen: eerst per orderregel, dan per dag en kanaal.
 */
export function mergeTransactions(transactions: MergeableTransaction[]): MergedTransaction[] {
  // ─── Pass 1: per fabricOrdregId ────────────────────────────
  const ordregGroups = new Map<string, MergeableTransaction[]>();
  const ungrouped: MergeableTransaction[] = [];

  for (const tx of transactions) {
    if (tx.fabricOrdregId != null) {
      const key = `${tx.fabricOrdregId}`;
      if (!ordregGroups.has(key)) ordregGroups.set(key, []);
      ordregGroups.get(key)!.push(tx);
    } else {
      ungrouped.push(tx);
    }
  }

  const pass1: MergedTransaction[] = [];

  /*
   * De verkoop en de correctie blijven aparte regels, en dat is niet cosmetisch.
   *
   * Ze werden samengevoegd tot één regel met de brúto stelen van de originele
   * orderregel en het nétto bedrag van alles bij elkaar. De prijs die daaruit
   * volgde had nooit bestaan: partij 3980666 toonde 2.680 stelen voor EUR 794,80
   * — dus EUR 0,297 per steel — terwijl er 2.680 stelen voor EUR 0,354 waren
   * verkocht en er daarna EUR 154,00 was afgeboekt. Wie dat naast de sales sheet
   * legt kan er niets van maken, want daar staat gewoon 0,354.
   *
   * Zo staat het nu zoals de afrekening het ook toont: de verkoop met zijn eigen
   * prijs, en de correctie eronder met de zijne.
   *
   * Álle originele regels tellen mee, niet alleen de eerste. Eén orderregel wordt
   * in delen geleverd — `marts.fct_orders` geeft dan een rij per deel onder
   * hetzelfde `ordreg_id`, en dat is de reden dat er geen unieke index op
   * (lotId, fabricOrdregId) ligt (zie CLAUDE.md). Dit stond hier als
   * `txs.find(t => t.bronFeitExtra === "origineel")`, waarmee de tweede rij nergens
   * meer in terechtkwam: niet bij `origineel` en niet bij `correcties`. Partij
   * 3645448 (PCXRONEN, levering 4324147) toonde daardoor op 08-05-2025 2.400
   * geveilde stelen voor EUR 446,40 waar de afrekening 3.000 voor EUR 558,00 drukt
   * — de rijen 600 en 2.400 onder ordreg 15674817. Gemeten op test: 1.205 zulke
   * groepen over 742 leveringen bij 43 leveranciers, samen 402.480 tot 1.266.414
   * stelen en EUR 102.245 tot EUR 320.498 die het scherm niet liet zien. Het is
   * een marge en geen getal omdat de rijen op `date` werden gesorteerd, wat niet
   * uniek is: wélke rij bleef staan, lag niet vast.
   */
  for (const txs of ordregGroups.values()) {
    const originelen = txs.filter((t) => t.bronFeitExtra === "origineel");
    const correcties = txs.filter((t) => t.bronFeitExtra !== "origineel");
    const base = originelen[0] ?? txs[0];

    if (originelen.length > 0) {
      const stems = originelen.reduce((s, t) => s + t.stems, 0);
      const amount = originelen.reduce((s, t) => s + parseFloat(t.amount), 0);
      pass1.push({
        id: base.id,
        date: base.date,
        salesType: base.salesType,
        stems,
        amount,
        // Bij één regel is dit de opgeslagen prijs; bij een gesplitste levering
        // het gewogen gemiddelde, net zoals pass 2 hieronder rekent.
        pricePerStem: originelen.length === 1 ? parseFloat(base.pricePerStem) : prijs(stems, amount),
        hasCorrection: false,
        correctionReasonId: null,
      });
    }

    const corrStems = correcties.reduce((s, t) => s + t.stems, 0);
    const corrAmount = correcties.reduce((s, t) => s + parseFloat(t.amount), 0);

    // Een correctie die per saldo niets verandert hoeft niemand te zien. Dat is
    // geen zeldzaamheid: een `prullenbak-factcor`-rij draagt altijd nul, en een
    // intrekking die meteen wordt teruggeboekt heft zichzelf op.
    if (correcties.length > 0 && (corrStems !== 0 || corrAmount !== 0)) {
      pass1.push({
        id: correcties[0].id,
        date: correcties[0].date,
        salesType: base.salesType,
        stems: corrStems,
        amount: corrAmount,
        pricePerStem: prijs(corrStems, corrAmount),
        hasCorrection: true,
        correctionReasonId: correcties.find((t) => t.correctionReasonId != null)?.correctionReasonId ?? null,
      });
    }

    // Geen originele regel én geen correctie die iets doet: dan blijft er niets
    // over om te tonen, maar de regel bestaat wel. Toon hem zoals hij is.
    if (originelen.length === 0 && (correcties.length === 0 || (corrStems === 0 && corrAmount === 0))) {
      pass1.push({
        id: base.id,
        date: base.date,
        salesType: base.salesType,
        stems: txs.reduce((s, t) => s + t.stems, 0),
        amount: txs.reduce((s, t) => s + parseFloat(t.amount), 0),
        pricePerStem: parseFloat(base.pricePerStem),
        hasCorrection: correcties.length > 0,
        correctionReasonId: correcties.find((t) => t.correctionReasonId != null)?.correctionReasonId ?? null,
      });
    }
  }

  for (const tx of ungrouped) {
    pass1.push({
      id: tx.id,
      date: tx.date,
      salesType: tx.salesType,
      stems: tx.stems,
      amount: parseFloat(tx.amount),
      pricePerStem: parseFloat(tx.pricePerStem),
      hasCorrection: false,
      correctionReasonId: null,
    });
  }

  // ─── Pass 2: per dag en kanaal ─────────────────────────────
  const dayGroups = new Map<string, MergedTransaction[]>();
  for (const tx of pass1) {
    const dayKey = new Date(tx.date).toISOString().slice(0, 10);
    const channel = channelLabel(tx.salesType);
    // Correcties krijgen een eigen sleutel, anders veegt deze stap ze alsnog bij
    // de verkoop waar de vorige stap ze net van heeft gescheiden — en dan is de
    // prijs weer het gemiddelde van twee dingen die niets met elkaar te maken hebben.
    const key = `${dayKey}::${channel}::${tx.hasCorrection ? "corr" : "verkoop"}`;
    if (!dayGroups.has(key)) dayGroups.set(key, []);
    dayGroups.get(key)!.push(tx);
  }

  const result: MergedTransaction[] = [];
  for (const [key, txs] of dayGroups) {
    const channel = key.split("::")[1];
    const totalStems = txs.reduce((s, t) => s + t.stems, 0);
    const totalAmount = txs.reduce((s, t) => s + t.amount, 0);

    result.push({
      id: txs[0].id,
      date: txs[0].date,
      salesType: channel,
      stems: totalStems,
      amount: totalAmount,
      pricePerStem: prijs(totalStems, totalAmount),
      hasCorrection: txs.some((t) => t.hasCorrection),
      correctionReasonId: txs.find((t) => t.correctionReasonId != null)?.correctionReasonId ?? null,
    });
  }

  result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return result;
}
