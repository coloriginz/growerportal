import en from "./en.json";
import nl from "./nl.json";

export const languages = {
  en: "English",
  nl: "Nederlands",
} as const;

export type Language = keyof typeof languages;

const translations = { en, nl } as const;

type TranslationKeys = typeof en;

type NestedKeyOf<T, Prefix extends string = ""> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object
        ? NestedKeyOf<T[K], `${Prefix}${K}.`>
        : `${Prefix}${K}`;
    }[keyof T & string]
  : never;

export type TranslationKey = NestedKeyOf<TranslationKeys>;

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current && typeof current === "object" && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return path;
    }
  }
  return typeof current === "string" ? current : path;
}

export function getTranslation(lang: Language, key: TranslationKey): string {
  return getNestedValue(
    translations[lang] as unknown as Record<string, unknown>,
    key
  );
}

export function createTranslator(lang: Language) {
  return (key: TranslationKey): string => getTranslation(lang, key);
}
