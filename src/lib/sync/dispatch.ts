import { resolveSyncEnv } from "@/lib/env";
import type { SyncEndpoint } from "./types";

export class DispatchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "DispatchError";
  }
}

/**
 * Stelt een kleine vraag aan de bron en wacht op het antwoord. Alleen voor
 * tellingen en min/max — het antwoord komt in de HTTP-response terug, dus het
 * moet per definitie klein zijn.
 */
export async function ask<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const url = process.env.PA_WEBHOOK_ASK_URL;
  if (!url) throw new DispatchError("PA_WEBHOOK_ASK_URL is niet gezet");

  const env = resolveSyncEnv();
  if (!env) throw new DispatchError("Vragen stellen kan niet vanuit development");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ env, query }),
  });

  if (!response.ok) {
    throw new DispatchError(
      `Vraag-flow gaf ${response.status}: ${(await response.text()).slice(0, 300)}`,
      response.status
    );
  }

  // Tweede laag naast de coalesce in de flow zelf: een query zonder rijen kan een
  // lege body opleveren in plaats van [], en dat is een geldig "niets gevonden".
  // De flow kan later door iemand anders aangepast worden, dus vertrouw er niet op.
  const text = await response.text();
  if (text.trim() === "") return [];
  return JSON.parse(text) as T[];
}

/**
 * Stuurt een query weg om uitgevoerd te worden. Keert direct terug: het
 * resultaat komt later binnen op /api/import/<endpoint>, gekoppeld via batchId.
 */
export async function fetchInto(
  endpoint: SyncEndpoint,
  batchId: string,
  query: string
): Promise<void> {
  const url = process.env.PA_WEBHOOK_FETCH_URL;
  if (!url) throw new DispatchError("PA_WEBHOOK_FETCH_URL is niet gezet");

  const env = resolveSyncEnv();
  if (!env) throw new DispatchError("Versturen kan niet vanuit development");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ env, endpoint, batchId, query }),
  });

  // 202 is het verwachte antwoord: de flow is gestart en draait door.
  if (!response.ok) {
    throw new DispatchError(
      `Haal-flow gaf ${response.status}: ${(await response.text()).slice(0, 300)}`,
      response.status
    );
  }
}
