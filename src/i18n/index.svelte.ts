import { de } from './de';
import { en } from './en';

export type Locale = 'de' | 'en';
export type MessageKey = keyof typeof de;

const dictionaries: Record<Locale, Record<MessageKey, string>> = { de, en };

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem('holdem.locale');
    if (saved === 'de' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'de';
  return nav?.toLowerCase().startsWith('de') ? 'de' : nav ? 'en' : 'de';
}

/** Reactive locale: reading `i18n.locale` inside templates re-renders on change. */
export const i18n = $state<{ locale: Locale }>({ locale: detectLocale() });

export function setLocale(l: Locale) {
  i18n.locale = l;
  try {
    localStorage.setItem('holdem.locale', l);
    document.documentElement.lang = l;
  } catch {
    /* ignore */
  }
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let s = dictionaries[i18n.locale][key] ?? de[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Thousands separators per locale (1.500 / 1,500). */
export function chips(n: number): string {
  return n.toLocaleString(i18n.locale === 'de' ? 'de-DE' : 'en-US');
}

export function handName(key: string): string {
  return t(`cat_${key}` as MessageKey);
}
