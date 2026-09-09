import type { RechargeConfig } from '../types/api.ts'

export type WalletCurrency = 'diamond' | 'gold'

/**
 * Keep the recommendation-only amount bounded before converting it to BigInt.
 * This is deliberately independent from order creation: the value is never
 * sent to the payment API.
 */
export const MAX_REQUIRED_AMOUNT_DIGITS = 30

export interface RechargeRecommendationQuery {
  rechargeCurrency: WalletCurrency
  requiredAmount: bigint
  requiredAmountText: string
}

export interface RecommendedPlan {
  plan: RechargeConfig
  creditedAmount: bigint
}

function singleQueryString(value: unknown) {
  // A repeated query parameter is ambiguous. Treat it as invalid instead of
  // silently selecting the first value.
  return typeof value === 'string' ? value : undefined
}

/** Parse the two optional recommendation parameters as an all-or-nothing pair. */
export function parseRechargeRecommendationQuery(query: Record<string, unknown>): RechargeRecommendationQuery | null {
  const rechargeCurrency = singleQueryString(query.rechargeCurrency)
  const requiredAmountText = singleQueryString(query.requiredAmount)

  if (rechargeCurrency !== 'diamond' && rechargeCurrency !== 'gold') return null
  if (!requiredAmountText || !/^\d+$/.test(requiredAmountText)) return null
  if (requiredAmountText.length > MAX_REQUIRED_AMOUNT_DIGITS) return null

  try {
    return {
      rechargeCurrency,
      requiredAmount: BigInt(requiredAmountText),
      requiredAmountText,
    }
  } catch {
    return null
  }
}

function read(plan: RechargeConfig, key: string): unknown {
  return plan[key]
}

function readInteger(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function firstInteger(plan: RechargeConfig, keys: string[]) {
  for (const key of keys) {
    const parsed = readInteger(read(plan, key))
    if (parsed !== null) return parsed
  }
  return null
}

function normalizedCurrency(value: unknown): WalletCurrency | null {
  if (typeof value !== 'string') return null
  const normalized = value.toLowerCase()
  return normalized === 'diamond' || normalized === 'gold' ? normalized : null
}

function nestedAmount(plan: RechargeConfig, key: string, currency: WalletCurrency) {
  const value = read(plan, key)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const object = value as Record<string, unknown>
  const matchingKey = Object.keys(object).find((key) => key.toLowerCase() === currency)
  const pluralKey = currency === 'diamond' ? 'diamonds' : 'coins'
  const matchingPluralKey = Object.keys(object).find((key) => key.toLowerCase() === pluralKey)
  return readInteger(matchingKey ? object[matchingKey] : undefined)
    ?? readInteger(matchingPluralKey ? object[matchingPluralKey] : undefined)
}

function genericCreditedAmount(plan: RechargeConfig, currency: WalletCurrency) {
  const declaredCurrency = [
    read(plan, 'creditedCurrency'),
    read(plan, 'creditCurrency'),
    read(plan, 'walletCurrency'),
    read(plan, 'rechargeCurrency'),
  ].map(normalizedCurrency).find(Boolean)

  // A generic creditedAmount is safe only when the response labels its wallet
  // currency. Never infer the wallet from the fiat `currency` field (which is
  // the package price currency in the current API).
  if (declaredCurrency !== currency) return null
  return firstInteger(plan, ['actualCreditedAmount', 'creditedAmount'])
}

function directCreditedAmount(plan: RechargeConfig, currency: WalletCurrency) {
  const fieldValue = currency === 'diamond'
    ? firstInteger(plan, ['actualCreditedDiamonds', 'actualCreditedDiamond', 'creditedDiamonds', 'creditedDiamond'])
    : firstInteger(plan, ['actualCreditedGold', 'creditedGold', 'actualCreditedCoins', 'creditedCoins'])
  if (fieldValue !== null) return fieldValue

  return nestedAmount(plan, 'actualCreditedAmounts', currency)
    ?? nestedAmount(plan, 'creditedAmounts', currency)
    ?? genericCreditedAmount(plan, currency)
}

function explicitBonus(plan: RechargeConfig, currency: WalletCurrency) {
  const fieldValue = currency === 'diamond'
    ? firstInteger(plan, ['bonusDiamonds', 'extraDiamonds', 'diamondBonus'])
    : firstInteger(plan, ['bonusGold', 'extraGold', 'goldBonus', 'bonusCoins'])
  if (fieldValue !== null) return fieldValue

  const value = read(plan, 'bonus')
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    return readInteger(object[currency])
      ?? readInteger(object[currency === 'diamond' ? 'diamonds' : 'coins'])
  }
  if (normalizedCurrency(read(plan, 'bonusCurrency')) === currency) return readInteger(value)
  return null
}

function explicitGoldToDiamondRate(plan: RechargeConfig) {
  const direct = firstInteger(plan, ['goldToDiamondRate', 'goldToDiamondsRate', 'diamondsPerGold'])
  if (direct !== null) return direct

  const relation = read(plan, 'conversionRelation') ?? read(plan, 'conversion')
  if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return null
  const object = relation as Record<string, unknown>
  const from = object.from ?? object.source
  const to = object.to ?? object.target
  const namedRelation = readInteger(object.goldToDiamond ?? object.goldToDiamonds ?? object.diamondsPerGold)
  if (namedRelation !== null && from === undefined && to === undefined) return namedRelation
  if (from !== 'gold' || to !== 'diamond') return null
  return readInteger(object.rate ?? object.multiplier ?? object.goldToDiamond)
}

/**
 * Resolve the amount that the backend says will arrive in a wallet.
 *
 * Direct actual/credited fields win. If an older response only has a base
 * `gold`/`coins` amount, that amount is used for gold without inventing a
 * bonus. Diamond recommendations require an explicit diamond amount or an
 * explicit gold→diamond relation returned by the backend.
 */
export function getPlanCreditedAmount(plan: RechargeConfig, currency: WalletCurrency): bigint | null {
  const direct = directCreditedAmount(plan, currency)
  // `actualCredited*`/`credited*` are final backend amounts. Adding a browser
  // calculated bonus here would double-count it.
  if (direct !== null) return direct

  const base = currency === 'gold'
    ? firstInteger(plan, ['gold', 'coins', 'goldAmount'])
    : firstInteger(plan, ['diamond', 'diamonds', 'diamondAmount'])
  if (base !== null) return base + (explicitBonus(plan, currency) ?? 0n)

  if (currency === 'diamond') {
    const goldBase = firstInteger(plan, ['gold', 'coins', 'goldAmount'])
    const rate = explicitGoldToDiamondRate(plan)
    if (goldBase !== null && rate !== null) {
      const creditedGold = goldBase + (explicitBonus(plan, 'gold') ?? 0n)
      return creditedGold * rate + (explicitBonus(plan, 'diamond') ?? 0n)
    }
  }

  return null
}

/** Pick the smallest credited amount that covers the requested deficit. */
export function findRecommendedPlan(
  plans: RechargeConfig[],
  query: RechargeRecommendationQuery | null,
): RecommendedPlan | null {
  if (!query) return null

  let recommendation: RecommendedPlan | null = null
  for (const plan of plans) {
    const creditedAmount = getPlanCreditedAmount(plan, query.rechargeCurrency)
    if (creditedAmount === null || creditedAmount < query.requiredAmount) continue
    if (!recommendation || creditedAmount < recommendation.creditedAmount) {
      recommendation = { plan, creditedAmount }
    }
  }
  return recommendation
}
