import {
  COIN_MERCHANT_CLIENT_HEADER,
  decryptMerchantBody,
  encryptMerchantBody,
} from './merchantCrypto'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status = 0, payload?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

export function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

export interface RequestOptions {
  token?: string
  signal?: AbortSignal
  merchantEncrypted?: boolean
}

function responseMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return undefined
  const value = payload as Record<string, unknown>
  const message = value.message ?? value.msg ?? value.error
  return typeof message === 'string' && message.trim() ? message : undefined
}

function responseCode(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('code' in payload)) return undefined
  const raw = (payload as Record<string, unknown>).code
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : raw.trim().toLowerCase()
  }
  return raw
}

function isSuccessCode(code: unknown) {
  return code === undefined || code === 0 || code === 200 || code === '0' || code === '200' || code === 'ok' || code === 'success'
}

export async function post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  // Apifox declares Authorization as an apiKey header. The Sora backend
  // expects the token value as-is (without a Bearer prefix).
  if (options.token) headers.Authorization = options.token
  // Merchant calls explicitly declare their wire mode. Keep the marker even
  // for plaintext requests so the backend can distinguish this client.
  if (options.merchantEncrypted !== undefined) {
    headers[COIN_MERCHANT_CLIENT_HEADER] = options.merchantEncrypted ? '1' : '0'
  }

  const wireBody = options.merchantEncrypted && body !== undefined
    ? await encryptMerchantBody(body)
    : JSON.stringify(body)

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: wireBody,
    signal: options.signal,
  })

  const text = await response.text()
  let payload: unknown = undefined
  if (options.merchantEncrypted) {
    try {
      payload = text ? await decryptMerchantBody(text) : undefined
    } catch (error) {
      throw new ApiError('The encrypted merchant API response could not be authenticated.', response.status, { cause: error })
    }
  } else {
    try {
      payload = text ? JSON.parse(text) : undefined
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    const message = responseMessage(payload) || `Request failed (${response.status})`
    throw new ApiError(message, response.status, payload)
  }

  // The API wraps successful and failed calls in { code, message, data }.
  // HTTP 200 is not sufficient to establish success: code=3 is an expired
  // token and other non-zero codes are business errors.
  const code = responseCode(payload)
  if (!isSuccessCode(code)) {
    throw new ApiError(responseMessage(payload) || `Request rejected (${String(code)})`, response.status, payload)
  }

  return unwrap<T>(payload)
}
