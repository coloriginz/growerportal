import type { TranslationKey } from "@/i18n";

const KNOWN_CODES = ["110", "120", "130", "154", "160", "170"] as const;

export function getQualityCodeKey(code: string): TranslationKey | null {
  if ((KNOWN_CODES as readonly string[]).includes(code)) {
    return `quality.code_${code}` as TranslationKey;
  }
  return null;
}

export function translateQualityCode(
  code: string,
  fallbackDescription: string,
  t: (key: TranslationKey) => string
): string {
  const key = getQualityCodeKey(code);
  if (key) {
    return t(key);
  }
  return fallbackDescription;
}
