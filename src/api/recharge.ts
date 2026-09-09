import { post } from './http'
import type {
  CheckRechargeOrderResponse,
  CreateChannelRechargeOrderResponse,
  FiatCurrencyResponse,
  RechargeConfig,
  RechargeConfigResponse,
} from '../types/api'

export const rechargeApi = {
  // This endpoint is explicitly unauthenticated and scopes the available
  // recharge tiers to the supplied user.
  getConfigs(userId: string) {
    return post<RechargeConfigResponse>('/rechargeCfg/rechargeCfgListByUserId', { userId })
  },

  getCurrencies(typeFilter = 0) {
    // typeFilter=0 requests all currencies. The catalog drives the currency
    // selector; the user-scoped recharge list remains the source of packages.
    return post<FiatCurrencyResponse>('/fiatCurrency/fiatCurrencyListForApp', { typeFilter })
  },

  // The channel endpoint is the unauthenticated flow used by this standalone
  // payment page. It requires the user ID, selected package and currency code,
  // then returns the provider payUrl.
  createOrder(input: { cfgId: number | string; currencyCode: string; userId: string }) {
    return post<CreateChannelRechargeOrderResponse>('/rechargeOrder/createChannelRechargeOrder', input)
  },

  checkOrder(orderId: string) {
    // Apifox defines only orderId in the request body. The current test
    // gateway still rejects this endpoint without an App token; the backend
    // must expose it as no-auth (or add a channel-specific status endpoint).
    return post<CheckRechargeOrderResponse>('/rechargeOrder/checkRechargeOrderSuccess', { orderId })
  },
}

export function normalizeConfigs(response: RechargeConfigResponse | RechargeConfig[] | undefined) {
  const list = Array.isArray(response) ? response : response?.list || []
  return [...list].sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
}

export function normalizeCurrencies(response: FiatCurrencyResponse | undefined) {
  return [...(response?.list || [])].sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
}

export function getProviderUrl(response: CreateChannelRechargeOrderResponse) {
  const candidates = [response.checkoutUrl, response.paymentUrl, response.payUrl, response.redirectUrl, response.url]
  for (const value of candidates) {
    if (typeof value !== 'string' || !value.trim()) continue
    try {
      const url = new URL(value)
      // Payment credentials and order details must not be sent over plaintext
      // HTTP. The backend should return a short-lived HTTPS URL only.
      if (url.protocol === 'https:' && url.hostname) return url.toString()
    } catch {
      // Ignore malformed provider URLs and let the checkout show its pending
      // state instead of navigating to an untrusted scheme.
    }
  }
  return undefined
}
