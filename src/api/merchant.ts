import { post } from './http.ts'
import { isMerchantEncryptionEnabled } from './merchantCrypto'
import type {
  CheckRechargeOrderResponse,
  CreateChannelRechargeOrderResponse,
  CoinMerchantRechargeConfigResponse,
  MerchantBalanceResponse,
  MerchantPayProfile,
  MerchantTransferResponse,
  SaveMerchantPayProfileResponse,
} from '../types/api'

export interface MerchantRechargeInput {
  cfgId: number | string
  currencyCode: string
}

export interface MerchantRechargeResponse extends CreateChannelRechargeOrderResponse {
  orderId: string
  status?: number | string
  message?: string
}

export interface MerchantTransferInput {
  targetUserId: string
  amount: number
}

/**
 * The paths and payloads below mirror the dedicated coin-merchant contracts
 * in Apifox. They intentionally do not reuse the end-user recharge flow:
 * merchant recharge credits the logged-in merchant wallet, while transfer
 * sends the merchant's gold to a target user.
 */
export const merchantApi = {
  getConfigs(token: string) {
    const path = import.meta.env.VITE_MERCHANT_CONFIG_PATH || '/coinMerchantRechargeCfg/coinMerchantRechargeCfgListForApp'
    return post<CoinMerchantRechargeConfigResponse>(path, {}, { token, merchantEncrypted: isMerchantEncryptionEnabled() })
  },

  createRecharge(input: MerchantRechargeInput, token: string) {
    const path = import.meta.env.VITE_MERCHANT_RECHARGE_PATH || '/rechargeOrder/createCoinMerchantChannelRechargeOrder'
    return post<MerchantRechargeResponse>(path, input, { token, merchantEncrypted: isMerchantEncryptionEnabled() })
  },

  checkRecharge(orderId: string, token: string) {
    const path = import.meta.env.VITE_MERCHANT_ORDER_STATUS_PATH || '/rechargeOrder/checkRechargeOrderSuccess'
    return post<CheckRechargeOrderResponse>(path, { orderId }, { token, merchantEncrypted: isMerchantEncryptionEnabled() })
  },

  transferGold(input: MerchantTransferInput, token: string) {
    const path = import.meta.env.VITE_MERCHANT_TRANSFER_PATH || '/gold/transferGold'
    return post<MerchantTransferResponse>(path, input, { token, merchantEncrypted: isMerchantEncryptionEnabled() })
  },

  getBalance(token: string) {
    const path = import.meta.env.VITE_MERCHANT_BALANCE_PATH || '/userInfo/get'
    return post<MerchantBalanceResponse>(path, {}, { token, merchantEncrypted: isMerchantEncryptionEnabled() })
  },

  getPayProfile(token: string) {
    const path = import.meta.env.VITE_MERCHANT_PROFILE_GET_PATH || '/rechargeOrder/getChannelPayUserProfile'
    return post<MerchantPayProfile | null>(path, {}, { token, merchantEncrypted: isMerchantEncryptionEnabled() })
  },

  savePayProfile(profile: { name: string; email: string; phone?: string }, token: string) {
    const path = import.meta.env.VITE_MERCHANT_PROFILE_SAVE_PATH || '/rechargeOrder/saveChannelPayUserProfile'
    return post<SaveMerchantPayProfileResponse>(path, profile, { token, merchantEncrypted: isMerchantEncryptionEnabled() })
  },
}
