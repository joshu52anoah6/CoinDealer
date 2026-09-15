const nonceLength = 12
const authenticationTagLength = 16

export const COIN_MERCHANT_CLIENT_HEADER = 'X-Coin-Merchant-Client'

function encryptionEnabled() {
  const value = String(import.meta.env.VITE_MERCHANT_API_ENCRYPTION ?? 'false').trim().toLowerCase()
  return !['0', 'false', 'off', 'no'].includes(value)
}

export function isMerchantEncryptionEnabled() {
  return encryptionEnabled()
}

function merchantSecret() {
  return String(import.meta.env.VITE_MERCHANT_API_KEY ?? '').trim()
}

function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function decodeBase64(value: string) {
  const normalized = value.trim()
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
    throw new Error('The encrypted merchant payload is not valid Base64.')
  }
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

let keyPromise: Promise<CryptoKey> | undefined

function getKey() {
  if (!encryptionEnabled()) throw new Error('Merchant API encryption is disabled.')
  const secret = merchantSecret()
  if (!secret) throw new Error('VITE_MERCHANT_API_KEY is required when merchant API encryption is enabled.')
  keyPromise ??= crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)).then((digest) =>
    crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
  )
  return keyPromise
}

export async function encryptMerchantBody(body: unknown) {
  const nonce = crypto.getRandomValues(new Uint8Array(nonceLength))
  const plaintext = new TextEncoder().encode(JSON.stringify(body))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv: nonce,
    tagLength: authenticationTagLength * 8,
  }, await getKey(), plaintext))
  const payload = new Uint8Array(nonce.length + ciphertext.length)
  payload.set(nonce)
  payload.set(ciphertext, nonce.length)
  return encodeBase64(payload)
}

export async function decryptMerchantBody(body: string) {
  const payload = decodeBase64(body)
  if (payload.length < nonceLength + authenticationTagLength) {
    throw new Error('The encrypted merchant response is too short.')
  }
  const nonce = payload.slice(0, nonceLength)
  const ciphertext = payload.slice(nonceLength)
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: nonce,
    tagLength: authenticationTagLength * 8,
  }, await getKey(), ciphertext)
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown
}
