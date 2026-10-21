import type { Localized } from './data';

/**
 * To add a language: create src/locales/<code>.json with the same keys as
 * es.json and add it here. Content (POI names) falls back to English, then
 * Spanish, when a translation is missing.
 */
export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'es', name: 'Español' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'ca', name: 'Català' },
  { code: 'eu', name: 'Euskara' },
];

type Dict = Record<string, string>;
// All languages are bundled with the app (a few KB each). Loading them on demand broke
// language switching on pages opened before a new deploy: the old chunk was gone.
const bundled = import.meta.glob<Dict>('./locales/*.json', { import: 'default', eager: true });
const FALLBACK = ['en', 'es'];
const STORAGE_KEY = 'oasismap.lang';

let lang = 'es';
const dicts: Record<string, Dict> = {};

async function loadDict(code: string): Promise<void> {
  if (dicts[code]) return;
  const dict = bundled[`./locales/${code}.json`];
  if (dict) dicts[code] = dict;
}

export function currentLang(): string {
  return lang;
}

export async function setLang(code: string): Promise<void> {
  await Promise.all([code, ...FALLBACK].map(loadDict));
  lang = dicts[code] ? code : 'es';
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* private mode: ignore */
  }
}

/** Saved choice, else the first browser language we support. */
export function detectLang(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    /* ignore */
  }
  for (const pref of navigator.languages ?? [navigator.language]) {
    const code = pref.toLowerCase().split('-')[0];
    if (LANGUAGES.some((l) => l.code === code)) return code;
  }
  return 'es';
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const raw = [lang, ...FALLBACK].map((c) => dicts[c]?.[key]).find((v) => v !== undefined) ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
}

/** Pick the best translation of POI content. */
export function pick(text: Localized | undefined): string {
  if (!text) return '';
  for (const c of [lang, ...FALLBACK]) if (text[c]) return text[c]!;
  return Object.values(text).find(Boolean) ?? '';
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(1, Math.round(m / 5) * 5)} m`;
  return `${(m / 1000).toLocaleString(lang, { maximumFractionDigits: 1 })} km`;
}
