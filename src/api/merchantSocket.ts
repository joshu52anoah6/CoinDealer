export type MerchantOrderState = 'pending' | 'success' | 'failed'

export interface MerchantOrderUpdate {
  orderId: string
  state: MerchantOrderState
  message?: string
  creditedAmount?: number
  balance?: number
  raw: unknown
}

function apiToWsOrigin() {
  const configured = import.meta.env.VITE_API_BASE_URL || window.location.origin
  return configured.replace(/^http/i, 'ws').replace(/\/$/, '')
}

export function merchantSocketUrl() {
  const configured = import.meta.env.VITE_MERCHANT_WS_URL?.trim()
  if (configured) return configured
  const path = import.meta.env.VITE_MERCHANT_WS_PATH || '/ws/merchant'
  return `${apiToWsOrigin()}${path.startsWith('/') ? path : `/${path}`}`
}

function unwrapMessage(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const object = value as Record<string, unknown>
  for (const key of ['data', 'payload', 'result']) {
    if (object[key] && typeof object[key] === 'object') return unwrapMessage(object[key]) || object
  }
  return object
}

function stringValue(...values: unknown[]) {
  return values.find((value): value is string | number => (typeof value === 'string' && value.trim().length > 0) || typeof value === 'number')
}

function numberValue(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function parseMerchantOrderUpdate(input: unknown, expectedOrderId?: string): MerchantOrderUpdate | null {
  let parsed = input
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input)
    } catch {
      return null
    }
  }
  const object = unwrapMessage(parsed)
  if (!object) return null
  const rawOrderId = stringValue(object.orderId, object.order_id, object.tradeNo, object.id)
  const orderId = rawOrderId === undefined ? '' : String(rawOrderId)
  if (!orderId || (expectedOrderId && orderId !== expectedOrderId)) return null

  const rawStatus = String(stringValue(object.status, object.orderStatus, object.state, object.event, object.type) || '').toLowerCase()
  const success = object.success === true || object.paid === true || object.completed === true
    || ['success', 'succeeded', 'paid', 'completed', 'complete', 'confirmed', 'finished', '1'].includes(rawStatus)
  const failed = object.success === false || object.failed === true
    || ['failed', 'failure', 'cancelled', 'canceled', 'expired', 'rejected', 'error', '2', '-1'].includes(rawStatus)

  return {
    orderId,
    state: success ? 'success' : failed ? 'failed' : 'pending',
    message: stringValue(object.message, object.msg, object.reason)?.toString(),
    creditedAmount: numberValue(object.creditedAmount, object.amount, object.gold, object.diamonds),
    balance: numberValue(object.balance, object.goldBalance, object.diamondBalance),
    raw: parsed,
  }
}

export interface MerchantSocketHandlers {
  onUpdate(update: MerchantOrderUpdate): void
  onState?(state: 'connecting' | 'connected' | 'closed' | 'error'): void
}

/**
 * Opens one authenticated order stream. Auth and subscription are sent as
 * JSON frames because browsers cannot set custom WebSocket headers. The exact
 * server message names can be changed centrally if the Apifox WS contract
 * uses different names.
 */
export function watchMerchantOrder(token: string, orderId: string, handlers: MerchantSocketHandlers) {
  const socket = new WebSocket(merchantSocketUrl())
  handlers.onState?.('connecting')

  socket.addEventListener('open', () => {
    handlers.onState?.('connected')
    socket.send(JSON.stringify({ type: 'authenticate', token }))
    socket.send(JSON.stringify({ type: 'subscribe', orderId }))
  })
  socket.addEventListener('message', (event) => {
    const update = parseMerchantOrderUpdate(event.data, orderId)
    if (update) handlers.onUpdate(update)
  })
  socket.addEventListener('error', () => handlers.onState?.('error'))
  socket.addEventListener('close', () => handlers.onState?.('closed'))

  return () => {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
  }
}
