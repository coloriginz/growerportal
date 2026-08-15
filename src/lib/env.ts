export const isTest = process.env.NEXT_PUBLIC_APP_ENV === "test"
  || process.env.NEXT_PUBLIC_APP_ENV === "development";

/**
 * Bepaalt naar welke portal Power Automate het resultaat terugstuurt. Komt uit
 * de omgevingsvariabele van de deployment en nooit uit een request — anders kan
 * één verkeerde aanroep testdata naar productie duwen.
 */
export type SyncEnv = "test" | "production";

/**
 * Leest dezelfde `NEXT_PUBLIC_APP_ENV` als `isTest` hierboven, maar met een eigen
 * interpretatie: hier is "development" bewust stil (`null`), want Power Automate
 * kan localhost niet bereiken. Elke andere waarde die geen "test" of "production"
 * is — ontbrekend, verkeerd gespeld, leeg — is geen bewuste development-toestand
 * maar een configuratiefout, en wordt hardop gelogd. Zonder die log zou de sync op
 * een omgeving met een kapotte env var voor altijd stilzwijgend niets versturen.
 */
export function resolveSyncEnv(): SyncEnv | null {
  const env = process.env.NEXT_PUBLIC_APP_ENV;
  if (env === "production") return "production";
  if (env === "test") return "test";
  if (env === "development") return null; // bewust stil: geen doelportal
  console.error(`resolveSyncEnv: onherkende NEXT_PUBLIC_APP_ENV waarde: "${env}"`);
  return null;
}
