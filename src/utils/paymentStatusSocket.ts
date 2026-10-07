export interface PaymentSocketFrame {
  readonly cmd: number
  readonly data: unknown
}

export interface RechargeSuccessPushData {
  readonly gold: number
  readonly goldBalance: number
  readonly orderId: string
  readonly payChannel: number
  readonly price: number
}

export type PaymentSocketConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline'

export interface PaymentStatusSocketSubscription {
  close(): void
}

export interface SubscribeToRechargeSuccessOptions {
  readonly url: string
  readonly token: string
  readonly orderId: string
  readonly onSuccess: (data: RechargeSuccessPushData) => void
  readonly onConnectionChange?: (state: PaymentSocketConnectionState) => void
  readonly onError?: (error: Error) => void
  readonly createSocket?: (url: string) => WebSocket
  readonly reconnectDelayMs?: number
  readonly expiredTimeMs?: number
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} is required.`)
  return normalized
}

export function createPaymentWebSocketUrl(url: string, token: string): string {
  const socketUrl = new URL(requireNonEmpty(url, 'Payment WebSocket URL'))
  if (socketUrl.protocol !== 'ws:' && socketUrl.protocol !== 'wss:') {
    throw new Error('Payment WebSocket URL must use ws:// or wss://.')
  }

  // Match the authenticated Sora/VueH5 transport. Remove existing query
  // parameters so stale credentials cannot survive a reconnect.
  socketUrl.search = ''
  socketUrl.searchParams.set('Authorization', requireNonEmpty(token, 'Payment token'))
  return socketUrl.toString()
}

export async function decodePaymentSocketMessage(data: unknown): Promise<string> {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    )
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new TextDecoder().decode(await data.arrayBuffer())
  }
  throw new TypeError('Unsupported payment WebSocket frame type.')
}

export function parsePaymentSocketFrames(raw: string): readonly PaymentSocketFrame[] {
  const decoded: unknown = JSON.parse(raw)
  if (!Array.isArray(decoded)) {
    throw new TypeError('Payment WebSocket payload must be an array.')
  }

  return decoded.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new TypeError('Payment WebSocket frame must be an object.')
    }
    const frame = item as Record<string, unknown>
    if (!Number.isInteger(frame.cmd)) {
      throw new TypeError('Payment WebSocket frame cmd must be an integer.')
    }
    return Object.freeze({ cmd: frame.cmd as number, data: frame.data })
  })
}

function nonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`Recharge success ${field} must be a non-negative number.`)
  }
  return value
}

export function parseRechargeSuccessPush(
  frame: PaymentSocketFrame,
): RechargeSuccessPushData | undefined {
  if (frame.cmd !== 40) return undefined
  if (!frame.data || typeof frame.data !== 'object') {
    throw new TypeError('Recharge success data must be an object.')
  }

  const data = frame.data as Record<string, unknown>
  const orderId = typeof data.orderId === 'string' ? data.orderId.trim() : ''
  if (!orderId) throw new TypeError('Recharge success orderId is required.')
  const payChannel = nonNegativeNumber(data.payChannel, 'payChannel')
  if (!Number.isInteger(payChannel) || payChannel > 255) {
    throw new TypeError('Recharge success payChannel must be an unsigned 8-bit integer.')
  }

  return Object.freeze({
    gold: nonNegativeNumber(data.gold, 'gold'),
    goldBalance: nonNegativeNumber(data.goldBalance, 'goldBalance'),
    orderId,
    payChannel,
    price: nonNegativeNumber(data.price, 'price'),
  })
}

export function parseRechargeSuccessForOrder(
  frame: PaymentSocketFrame,
  expectedOrderId: string,
): RechargeSuccessPushData | undefined {
  const recharge = parseRechargeSuccessPush(frame)
  return recharge?.orderId === expectedOrderId.trim() ? recharge : undefined
}

function terminalConnectionError(frame: PaymentSocketFrame): Error | undefined {
  if (frame.cmd === 1) {
    const code = frame.data && typeof frame.data === 'object' && 'code' in frame.data
      ? String((frame.data as { code: unknown }).code)
      : 'unknown'
    return new Error(`Payment WebSocket authentication failed (${code}).`)
  }
  if (frame.cmd === 3) return new Error('Payment WebSocket session was signed out.')
  if (frame.cmd === 4) return new Error('Payment WebSocket server is unavailable.')
  if (frame.cmd === 5) return new Error('Payment WebSocket session was replaced by another connection.')
  return undefined
}

export function subscribeToRechargeSuccess(
  options: SubscribeToRechargeSuccessOptions,
): PaymentStatusSocketSubscription {
  const expectedOrderId = requireNonEmpty(options.orderId, 'Payment order ID')
  const socketUrl = createPaymentWebSocketUrl(options.url, options.token)
  let socket: WebSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let expiredTimer: ReturnType<typeof setTimeout> | undefined
  let receiveQueue: Promise<void> = Promise.resolve()
  let disposed = false
  let terminal = false

  const setConnectionState = (state: PaymentSocketConnectionState) => {
    if (!disposed) options.onConnectionChange?.(state)
  }

  const clearExpiration = () => {
    if (expiredTimer) clearTimeout(expiredTimer)
    expiredTimer = undefined
  }

  const scheduleReconnect = () => {
    if (disposed || terminal || reconnectTimer) return
    setConnectionState('reconnecting')
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      connect(true)
    }, options.reconnectDelayMs ?? 3_000)
  }

  const refreshExpiration = (activeSocket: WebSocket) => {
    clearExpiration()
    expiredTimer = setTimeout(() => {
      if (disposed || terminal || socket !== activeSocket) return
      socket = undefined
      if (activeSocket.readyState < 2) activeSocket.close(4000, 'payment-websocket-expired')
      scheduleReconnect()
    }, options.expiredTimeMs ?? 20_000)
  }

  const receivePayload = (raw: string, activeSocket: WebSocket) => {
    for (const frame of parsePaymentSocketFrames(raw)) {
      const terminalError = terminalConnectionError(frame)
      if (terminalError) {
        terminal = true
        clearExpiration()
        socket = undefined
        options.onError?.(terminalError)
        if (activeSocket.readyState < 2) activeSocket.close(4002, 'payment-websocket-terminal')
        setConnectionState('offline')
        return
      }

      const recharge = parseRechargeSuccessForOrder(frame, expectedOrderId)
      if (!recharge) continue
      terminal = true
      clearExpiration()
      socket = undefined
      options.onSuccess(recharge)
      if (activeSocket.readyState < 2) activeSocket.close(1000, 'payment-status-received')
      return
    }
  }

  function connect(isReconnect: boolean) {
    if (disposed || terminal) return
    setConnectionState(isReconnect ? 'reconnecting' : 'connecting')
    try {
      const activeSocket = options.createSocket?.(socketUrl) ?? new WebSocket(socketUrl)
      activeSocket.binaryType = 'arraybuffer'
      socket = activeSocket
      activeSocket.addEventListener('open', () => {
        if (disposed || terminal || socket !== activeSocket) return
        refreshExpiration(activeSocket)
        setConnectionState('connected')
      })
      activeSocket.addEventListener('message', (event) => {
        if (disposed || terminal || socket !== activeSocket) return
        refreshExpiration(activeSocket)
        receiveQueue = receiveQueue
          .then(async () => {
            const raw = await decodePaymentSocketMessage(event.data)
            if (!disposed && !terminal && socket === activeSocket) {
              receivePayload(raw, activeSocket)
            }
          })
          .catch((error: unknown) => {
            options.onError?.(error instanceof Error ? error : new Error(String(error)))
          })
      })
      activeSocket.addEventListener('error', () => {
        if (!disposed && !terminal && socket === activeSocket) {
          setConnectionState('reconnecting')
        }
      })
      activeSocket.addEventListener('close', () => {
        if (disposed || socket !== activeSocket) return
        clearExpiration()
        socket = undefined
        scheduleReconnect()
      })
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)))
      scheduleReconnect()
    }
  }

  connect(false)

  return Object.freeze({
    close() {
      if (disposed) return
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = undefined
      clearExpiration()
      const activeSocket = socket
      socket = undefined
      if (activeSocket && activeSocket.readyState < 2) {
        activeSocket.close(1000, 'payment-status-listener-disposed')
      }
    },
  })
}
