import type { MerchantPayProfile } from '../types/api'

function profileField(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeMerchantPayProfile(value: unknown): Required<MerchantPayProfile> {
  if (!value || typeof value !== 'object') return { name: '', email: '', phone: '' }
  const profile = value as Record<string, unknown>
  return {
    name: profileField(profile.name),
    email: profileField(profile.email),
    phone: profileField(profile.phone),
  }
}

/** Apifox defines empty name/email/phone values as a profile that was never saved. */
export function isMerchantPayProfileEmpty(value: unknown) {
  const profile = normalizeMerchantPayProfile(value)
  return !profile.name && !profile.email && !profile.phone
}
