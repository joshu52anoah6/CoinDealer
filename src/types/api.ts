export interface RechargeConfig {
  id: number | string
  currency?: string
  description?: string
  firstRechargeRatio?: number
  extraGold?: number
  gold?: number
  icon?: string
  name?: string
  packageName?: string
  price?: number
  productId?: string
  sort?: number
  status?: number
  // The user-scoped Apifox response marks first-recharge eligibility per tier.
  firstRecharge?: boolean
  isFirstRecharge?: boolean
  isFirst?: boolean
  // Wallet amounts are optional because older gateways only returned `gold`.
  // When present, the explicit credited/actual fields are authoritative and
  // already include whatever bonus policy the backend applied.
  creditedAmount?: number | string
  creditedCurrency?: string
  creditedGold?: number | string
  creditedDiamonds?: number | string
  creditedCoins?: number | string
  creditedDiamond?: number | string
  actualCreditedAmount?: number | string
  actualCreditedGold?: number | string
  actualCreditedDiamonds?: number | string
  actualCreditedCoins?: number | string
  actualCreditedDiamond?: number | string
  bonusIncluded?: boolean
  bonusGold?: number | string
  bonusDiamonds?: number | string
  bonusCurrency?: string
  extraDiamonds?: number | string
  // An explicit backend conversion relation may be used when a tier is
  // expressed as gold/coins but the business deficit is in diamonds.
  goldToDiamondRate?: number | string
  goldToDiamondsRate?: number | string
  diamondsPerGold?: number | string
  conversion?: Record<string, unknown>
  conversionRelation?: Record<string, unknown>
  [key: string]: unknown
}

export interface RechargeConfigResponse {
  list?: RechargeConfig[]
}

export interface FiatCurrency {
  currencyCode: string
  currencyType?: number
  icon?: string
  name?: string
  sort?: number
  symbol?: string
  [key: string]: unknown
}

export interface FiatCurrencyResponse {
  list?: FiatCurrency[]
}

export interface FirstRechargePrivilege {
  icon?: string
  descEn?: string
  descEs?: string
  descHi?: string
  descId?: string
  descPt?: string
  [key: string]: unknown
}

export interface FirstRechargeActivity {
  enabled: boolean
  firstRecharge: boolean
  icon?: string
  privileges?: FirstRechargePrivilege[]
  rechargeBtnTextEn?: string
  rechargeBtnTextEs?: string
  rechargeBtnTextHi?: string
  rechargeBtnTextId?: string
  rechargeBtnTextPt?: string
  titleEn?: string
  titleEs?: string
  titleHi?: string
  titleId?: string
  titlePt?: string
  [key: string]: unknown
}

export interface CreateChannelRechargeOrderResponse {
  currency?: string
  obfuscatedAccountId?: string
  orderId?: string
  price?: number
  status?: number | string
  payUrl?: string
  checkoutUrl?: string
  paymentUrl?: string
  redirectUrl?: string
  url?: string
  [key: string]: unknown
}

/** @deprecated Use CreateChannelRechargeOrderResponse for the no-auth channel flow. */
export type CreateRechargeOrderResponse = CreateChannelRechargeOrderResponse

export interface CheckRechargeOrderResponse {
  success?: boolean
  gold?: number
  goldBalance?: number
  price?: number
  [key: string]: unknown
}
