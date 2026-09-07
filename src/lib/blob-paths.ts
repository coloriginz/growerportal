import { del } from "@vercel/blob";

/*
 * Test en productie delen één blobopslag, en dat is een bewuste keuze.
 *
 * Twee stores zouden elke keer dat de productiedatabase naar test afzakt een
 * bestandsmigratie erbij vragen — precies op het moment dat je haast hebt.
 * Eén store is goedkoper, mits de omgevingen elkaars bestanden niet kunnen
 * overschrijven of weggooien. Dat is wat dit bestand regelt: elke upload komt
 * onder een map met de naam van zijn omgeving te staan, en verwijderen mag
 * alleen binnen de eigen map.
 *
 * Gemeten op 7 september 2026, vóór deze scheiding: 5.098 bestanden (0,81 GB)
 * in store `tibdecxmel5sovbj`, waarvan 38 voucher-PDF's door de test- én de
 * productiedatabase werden aangewezen — dezelfde URL in beide. Eén DELETE in
 * test haalde daar het bestand van productie onderuit, en dat was niet te zien.
 */

export type BlobEnv = "prod" | "test" | "unknown";

/**
 * Vertaalt `NEXT_PUBLIC_APP_ENV` naar de map waarin deze omgeving schrijft.
 *
 * Lokale ontwikkeling deelt de database met test en deelt daarom ook de map:
 * ze wijzen naar dezelfde `Document`-rijen, dus een aparte map zou alleen
 * betekenen dat de een niet mag opruimen wat de ander heeft gemaakt.
 *
 * Een onbekende waarde krijgt bewust een eigen map in plaats van terug te
 * vallen op "test". Valt de variabele op productie ooit weg, dan is het
 * alternatief dat productiebestanden in de testmap belanden en test ze
 * vervolgens mág verwijderen — precies de fout die deze scheiding moet
 * voorkomen. Een aparte map is dan onhandig maar veilig, en luidruchtig.
 */
export function resolveBlobEnv(appEnv: string | undefined): BlobEnv {
  if (appEnv === "production") return "prod";
  if (appEnv === "test" || appEnv === "development") return "test";
  console.error(`resolveBlobEnv: onherkende NEXT_PUBLIC_APP_ENV waarde: "${appEnv}"`);
  return "unknown";
}

/** Zet het pad van een upload onder de map van zijn omgeving. */
export function blobPath(env: BlobEnv, path: string): string {
  return `${env}/${path.replace(/^\/+/, "")}`;
}

/**
 * Mag deze omgeving dit bestand weggooien?
 *
 * Alleen als het in de eigen map staat. Bestanden van vóór deze scheiding
 * staan zonder mapnaam in de store (`salessheets/…`) en horen daarmee bij
 * niemand: die blijven staan, ook als de rij die ernaar wees verdwijnt. Dat is
 * de veilige kant — ze kunnen door de andere omgeving in gebruik zijn, en een
 * verweesd bestand kost opslag terwijl een ten onrechte verwijderd bestand niet
 * terug te halen is. Opruimen kan later alsnog, met beide databases ernaast.
 */
export function isOwnBlob(env: BlobEnv, url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.replace(/^\/+/, "");
  } catch {
    return false; // geen leesbare URL is geen bewijs van eigendom
  }
  return pathname.startsWith(`${env}/`);
}

/** De omgeving van deze deployment. */
export function currentBlobEnv(): BlobEnv {
  return resolveBlobEnv(process.env.NEXT_PUBLIC_APP_ENV);
}

/** Het pad waaronder deze deployment uploadt. */
export function blobKey(path: string): string {
  return blobPath(currentBlobEnv(), path);
}

/**
 * Verwijdert een blob, maar alleen als hij van deze omgeving is.
 *
 * Geeft terug of er daadwerkelijk iets is weggegooid, zodat een aanroeper dat
 * kan loggen. Een mislukte verwijdering is nooit fataal: de databaserij is de
 * waarheid, het bestand erachter hooguit ballast.
 */
export async function deleteOwnBlob(url: string): Promise<boolean> {
  if (!isOwnBlob(currentBlobEnv(), url)) return false;
  try {
    await del(url);
    return true;
  } catch {
    return false;
  }
}
