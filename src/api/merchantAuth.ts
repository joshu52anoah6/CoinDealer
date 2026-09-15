import { post } from './http.ts'
import { isMerchantEncryptionEnabled } from './merchantCrypto'
import { md5Hex } from '../utils/md5'
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
  const path = import.meta.env.VITE_MERCHANT_LOGIN_PATH || '/auth/coinMerchantLogin'
  return post<unknown>(path, { username: account, password: md5Hex(password) }, { merchantEncrypted: isMerchantEncryptionEnabled() })
    // This endpoint itself is restricted to coin merchants and its response
    // intentionally contains only a token, so no role field is returned.
    .then((payload) => normalizeMerchantLoginResponse(payload, { assumeMerchantRole: true }))
}
