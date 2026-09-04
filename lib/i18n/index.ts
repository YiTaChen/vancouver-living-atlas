import en from './en.json';
import fr from './fr.json';
import es from './es.json';
import zhHant from './zh-Hant.json';
import zhHans from './zh-Hans.json';

export const LANGUAGES = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'fr', label: 'Français', short: 'FR' },
  { id: 'es', label: 'Español', short: 'ES' },
  { id: 'zh-Hant', label: '中文（繁體）', short: '繁' },
  { id: 'zh-Hans', label: '中文（简体）', short: '简' },
] as const;

export type Locale = (typeof LANGUAGES)[number]['id'];
export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'vancouver-atlas-language';
export const MESSAGES: Record<Locale, Messages> = {
  en,
  fr,
  es,
  'zh-Hant': zhHant,
  'zh-Hans': zhHans,
};

export function resolveLocale(value: unknown): Locale {
  return LANGUAGES.some((language) => language.id === value)
    ? (value as Locale)
    : DEFAULT_LOCALE;
}

export function translate(
  locale: Locale,
  key: MessageKey,
  values: Record<string, string | number> = {},
): string {
  return MESSAGES[locale][key].replace(/\{(\w+)\}/g, (match, name) =>
    values[name] === undefined ? match : String(values[name]),
  );
}

export function viewText(
  locale: Locale,
  id: string,
  field: 'name' | 'tag' | 'description',
) {
  return translate(locale, `view.${id}.${field}` as MessageKey);
}
