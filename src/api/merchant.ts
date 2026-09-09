import { post } from './http.ts'
import type { CreateChannelRechargeOrderResponse, RechargeConfigResponse } from '../types/api'

export interface MerchantRechargeInput {
  userId: string
  cfgId: number | string
  currencyCode: string
}

export interface MerchantRechargeResponse extends CreateChannelRechargeOrderResponse {
  orderId: string
  status?: number | string
  message?: string
}

/**
 * These paths mirror the authenticated App order contract by default. If the
 * Apifox project exposes dedicated merchant paths, set the corresponding
 * VITE_MERCHANT_* variables without changing the UI code.
 */
export const merchantApi = {
  getConfigs(userId: string, token: string) {
    const path = import.meta.env.VITE_MERCHANT_CONFIG_PATH || '/rechargeCfg/rechargeCfgListByUserId'
    return post<RechargeConfigResponse>(path, { userId }, { token })
  },

  createRecharge(input: MerchantRechargeInput, token: string) {
    const path = import.meta.env.VITE_MERCHANT_RECHARGE_PATH || '/rechargeOrder/createRechargeOrder'
    return post<MerchantRechargeResponse>(path, input, { token })
  },
}
