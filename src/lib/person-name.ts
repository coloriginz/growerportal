/**
 * Een persoonsnaam in drie delen: voornaam, tussenvoegsel, achternaam.
 *
 * De database houdt daarnaast `User.name` aan als samengestelde weergavenaam.
 * Dat veld is niet overbodig: het staat in de sidebar, in e-mails en als
 * bevroren `actorName` in de fust-audit, en die plekken moeten blijven werken
 * zonder overal drie velden aan elkaar te plakken. Samenstellen gebeurt op één
 * plek — `composeName()` — zodat de weergavenaam nooit iets anders kan zeggen
 * dan de losse velden.
 */
export interface PersonNameParts {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
}

/**
 * Nederlandse tussenvoegsels, en de buitenlandse die in deze klantenkring
 * voorkomen (Spaans, Portugees, Italiaans, Duits). Langere combinaties staan
 * vooraan: `splitPersonName` pakt de langste die past, anders zou "van der Berg"
 * bij "van" blijven steken en "der Berg" als achternaam overhouden.
 */
const NAME_PARTICLES = [
  "van der", "van den", "van het", "van de", "van 't",
  "in het", "in den", "in de", "in 't",
  "op het", "op den", "op de", "op 't",
  "aan den", "aan de", "uit den", "uit de", "bij de",
  "von der", "de la", "de las", "de los", "van", "de", "den", "der", "des",
  "het", "'t", "ten", "ter", "te", "op", "von", "zu", "da", "das", "del",
  "della", "di", "do", "dos", "du", "la", "le", "las", "los", "mac", "mc",
];

/** Meerdere spaties, tabs en newlines tellen als één scheiding. */
function words(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

/**
 * De weergavenaam: voornaam, tussenvoegsel en achternaam met enkele spaties
 * ertussen. Lege delen vallen weg, zodat een naam zonder tussenvoegsel geen
 * dubbele spatie krijgt.
 */
export function composeName(parts: PersonNameParts): string {
  return [parts.firstName, parts.middleName, parts.lastName]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

/**
 * Splitst een bestaande weergavenaam in drie delen. Dit is een heuristiek en
 * geen waarheid — voor de bestaande gebruikers is het de enige manier om aan
 * losse velden te komen zonder ze allemaal met de hand na te lopen.
 *
 * De regel: het eerste woord is de voornaam, daarna zo veel mogelijk woorden
 * die samen een tussenvoegsel vormen, en de rest is achternaam. Een naam van
 * één woord wordt een voornaam zonder achternaam — dat is zichtbaar onvolledig
 * en vraagt om aanvulling, terwijl een verzonnen achternaam dat verbergt.
 */
export function splitPersonName(name: string): {
  firstName: string;
  middleName: string;
  lastName: string;
} {
  const parts = words(name ?? "");
  if (parts.length === 0) return { firstName: "", middleName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], middleName: "", lastName: "" };

  const firstName = parts[0];
  const rest = parts.slice(1);

  for (const particle of NAME_PARTICLES) {
    const count = particle.split(" ").length;
    // Alleen als er ná het tussenvoegsel nog een achternaam overblijft: "Jan de"
    // is geen naam met tussenvoegsel maar iemand die "de" heet.
    if (rest.length <= count) continue;
    const candidate = rest.slice(0, count).join(" ").toLowerCase();
    if (candidate === particle) {
      return {
        firstName,
        middleName: rest.slice(0, count).join(" "),
        lastName: rest.slice(count).join(" "),
      };
    }
  }

  return { firstName, middleName: "", lastName: rest.join(" ") };
}
