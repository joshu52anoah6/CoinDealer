export type Locale = 'en' | 'es' | 'hi' | 'id' | 'pt'

const suffix: Record<Locale, string> = {
  en: 'En',
  es: 'Es',
  hi: 'Hi',
  id: 'Id',
  pt: 'Pt',
}

export function resolveLocale(value?: string): Locale {
  const normalized = (value || navigator.language || 'en').toLowerCase().slice(0, 2) as Locale
  return normalized in suffix ? normalized : 'en'
}

export function localized<T extends Record<string, unknown>>(object: T | undefined, base: string, locale: Locale, fallback = '') {
  if (!object) return fallback
  const preferred = object[`${base}${suffix[locale]}`]
  if (typeof preferred === 'string' && preferred) return preferred
  const english = object[`${base}En`]
  return typeof english === 'string' && english ? english : fallback
}

export const currencySymbols: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CNY: '¥',
  INR: '₹',
  BRL: 'R$',
  IDR: 'Rp',
}

export function formatMoney(value: number | undefined, currency: string) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    return `${currencySymbols[currency] || currency} ${value.toFixed(2)}`
  }
}

