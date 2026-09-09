import { post } from './http.ts'
export {
  clearMerchantSession,
  isMerchantRole,
  normalizeMerchantLoginResponse,
  readMerchantSession,
  saveMerchantSession,
} from './merchantSession'
export type { MerchantRole, MerchantSession } from './merchantSession'
import { normalizeMerchantLoginResponse, type MerchantSession } from './merchantSession'

export function merchantLogin(account: string, password: string) {
  const path = import.meta.env.VITE_MERCHANT_LOGIN_PATH || '/merchant/login'
  return post<unknown>(path, { account, username: account, password })
    .then((payload) => normalizeMerchantLoginResponse(payload))
}
