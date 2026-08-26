import type { SyncEndpoint } from "./types";

/** Eén kalenderkwartaal: `from` inclusief, `to` exclusief. */
export type BackfillChunk = { from: Date; to: Date; label: string };

/**
 * Het begin van het kwartaal waar deze datum in valt, in UTC.
 *
 * Alles hier rekent in UTC omdat de vensters als UTC-instant naar Fabric gaan;
 * met lokale getters zou de indeling van dezelfde basisdatum verschuiven met de
 * tijdzone van de machine die de backfill start.
 *
 * Geëxporteerd omdat de startdatum per leverancier dezelfde indeling moet
 * gebruiken als de brokken: wie de ondergrens op een dag in plaats van op een
 * kwartaalgrens toepast, krijgt bij een eerste levering middenin het kwartaal
 * van de globale datum een andere uitkomst dan de brokken erna.
 */
export function quarterStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
}

function addQuarter(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 1));
}

/**
 * Het kwartaal waar een datum in valt, als "2025 Q3".
 *
 * Apart en geëxporteerd omdat de voortgangskaart hetzelfde label wil voor een
 * job die al in de wachtrij staat. Dat label is af te leiden uit `windowFrom` —
 * een kolom op `SyncJob` zou dezelfde waarheid een tweede keer opslaan.
 */
export function quarterLabel(date: Date): string {
  return `${date.getUTCFullYear()} Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/**
 * De brokken van een backfill: kalenderkwartalen vanaf het kwartaal waarin de
 * basisdatum valt tot en met het kwartaal van nu.
 *
 * Kalenderkwartalen en niet "elke negentig dagen vanaf de basisdatum": ze zijn
 * leesbaar in het scherm en een tweede backfill levert exact dezelfde vensters
 * op, zodat twee rondes te vergelijken zijn.
 *
 * Waarom kwartalen en geen jaren of maanden: gemeten op 20 augustus is het
 * zwaarste kwartaal van de zwaarste kandidaat 6.372 orderregels. Power Automate
 * kwam niet meer terug bij 15.229 en net wel bij 11.128, dus een kwartaal past
 * met ruime marge terwijl een jaar dat niet doet.
 */
export function quarterChunks(startDate: Date, now: Date): BackfillChunk[] {
  const chunks: BackfillChunk[] = [];
  const laatste = quarterStart(now);

  // `<=` op twee Dates vergelijkt de onderliggende tijdstempels; `addQuarter`
  // schuift altijd drie maanden op, dus de lus loopt gegarandeerd af.
  for (let from = quarterStart(startDate); from <= laatste; from = addQuarter(from)) {
    chunks.push({ from, to: addQuarter(from), label: quarterLabel(from) });
  }

  return chunks;
}

/** Eén job binnen een backfill, nog zonder runId. */
export type BackfillJobSpec = {
  sequence: number;
  endpoint: SyncEndpoint;
  from: Date;
  to: Date;
  /** Het kwartaal waar deze job bij hoort; null voor de stamdata vooraan. */
  label: string | null;
};

/** De endpoints die per kwartaal herhaald worden, in ketenvolgorde. */
const PER_KWARTAAL: readonly SyncEndpoint[] = ["lots", "orders", "costs"];

/**
 * De joblijst van een backfill, in de volgorde waarin de wachtrij hem afwerkt.
 *
 * Kwekers staan vooraan en maar één keer: die query kent geen datumvenster —
 * hij pakt alle kwekers van deze leverancier via zijn partijen. Hij moet wél
 * eerst, want de lots-import gooit partijen stilzwijgend weg waarvan de kweker
 * ontbreekt. Zijn venster is de volle spanwijdte, puur omdat de kolommen niet
 * leeg mogen zijn; de query gebruikt het niet.
 *
 * Leveranciers zitten er niet bij: die bestaat al, dat is de aanleiding.
 *
 * Alles in één runId, niet één runId per kwartaal. De wachtrij wacht binnen een
 * run op het vorige volgnummer, en dat is precies wat hier nodig is: kwekers
 * vóór alle kwartalen, en binnen een kwartaal de ketenvolgorde. Met een runId
 * per kwartaal is er geen mechanisme dat kwekers vóór de rest houdt.
 */
export function backfillJobs(chunks: readonly BackfillChunk[]): BackfillJobSpec[] {
  // Een basisdatum in de toekomst levert geen brokken op; zonder deze afvanger
  // zou de stamdatajob hieronder een leeg `chunks[0]` uitlezen.
  if (chunks.length === 0) return [];

  const jobs: BackfillJobSpec[] = [
    {
      sequence: 0,
      endpoint: "growers",
      from: chunks[0].from,
      to: chunks[chunks.length - 1].to,
      label: null,
    },
  ];

  for (const chunk of chunks) {
    for (const endpoint of PER_KWARTAAL) {
      jobs.push({
        sequence: jobs.length,
        endpoint,
        from: chunk.from,
        to: chunk.to,
        label: chunk.label,
      });
    }
  }

  return jobs;
}
