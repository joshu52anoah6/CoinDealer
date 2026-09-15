export type MerchantRole = 'merchant'

export interface MerchantSession {
  token: string
  refreshToken?: string
  merchantId?: string
  username?: string
  role: MerchantRole
  expiresAt?: number
}

const SESSION_KEY = 'payment.merchant.session'

function storage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function isMerchantRole(value: unknown): value is MerchantRole {
  if (typeof value !== 'string') return false
  return ['merchant', 'coin_merchant', 'coinmerchant', 'role_merchant'].includes(value.trim().toLowerCase())
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
}

function roleValue(candidate: unknown) {
  if (typeof candidate === 'string') return candidate
  if (candidate && typeof candidate === 'object') {
    const object = candidate as Record<string, unknown>
    return object.code ?? object.name ?? object.role
  }
  return undefined
}

function readRole(value: Record<string, unknown>) {
  const roles = Array.isArray(value.roles) ? value.roles : []
  const candidates = [value.role, value.userRole, value.userType, value.accountType, ...roles]
  return candidates.find((candidate) => isMerchantRole(roleValue(candidate))) ? 'merchant' as const : undefined
}

/** Normalizes the coin-merchant login response into one session shape. */
export function normalizeMerchantLoginResponse(
  payload: unknown,
  options: { assumeMerchantRole?: boolean } = {},
): MerchantSession | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as Record<string, unknown>
  const user = value.user && typeof value.user === 'object' ? value.user as Record<string, unknown> : {}
  const token = firstString(value.token, value.accessToken, value.access_token, user.token, user.accessToken)
  const role = readRole({ ...value, ...user }) || (options.assumeMerchantRole && token ? 'merchant' : undefined)
  if (!token || !role) return null

  const expiresAtValue = value.expiresAt ?? value.expireAt ?? user.expiresAt ?? user.expireAt
  const rawExpiresAt = typeof expiresAtValue === 'number'
    ? expiresAtValue
    : typeof expiresAtValue === 'string' && /^\d+$/.test(expiresAtValue) ? Number(expiresAtValue) : undefined
  // Unix timestamps are commonly returned in seconds; storage uses ms.
  const expiresAt = rawExpiresAt !== undefined && rawExpiresAt < 1_000_000_000_000
    ? rawExpiresAt * 1000
    : rawExpiresAt

  const session: MerchantSession = {
    token,
    role,
  }
  const refreshToken = firstString(value.refreshToken, value.refresh_token, user.refreshToken)
  const merchantId = firstString(value.merchantId, value.merchant_id, user.merchantId, user.id)
  const username = firstString(value.username, value.account, user.username, user.account)
  if (refreshToken) session.refreshToken = refreshToken
  if (merchantId) session.merchantId = merchantId
  if (username) session.username = username
  if (expiresAt !== undefined) session.expiresAt = expiresAt
  return session
}

export function readMerchantSession(): MerchantSession | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as MerchantSession
    if (!session || typeof session.token !== 'string' || !isMerchantRole(session.role)) return null
    if (session.expiresAt && session.expiresAt < Date.now()) {
      store.removeItem(SESSION_KEY)
      return null
    }
    return { ...session, role: 'merchant' }
  } catch {
    return null
  }
}

export function saveMerchantSession(session: MerchantSession) {
  storage()?.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearMerchantSession() {
  storage()?.removeItem(SESSION_KEY)
}
