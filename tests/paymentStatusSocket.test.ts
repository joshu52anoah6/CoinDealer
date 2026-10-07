import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPaymentWebSocketUrl,
  decodePaymentSocketMessage,
  parsePaymentSocketFrames,
  parseRechargeSuccessForOrder,
  parseRechargeSuccessPush,
  subscribeToRechargeSuccess,
} from '../src/utils/paymentStatusSocket.ts'

class FakeWebSocket {
  binaryType: BinaryType = 'blob'
  readyState = 0
  closeCode?: number
  closeReason?: string
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>()

  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string, event: { data?: unknown } = {}) {
    if (type === 'open') this.readyState = 1
    for (const listener of this.listeners.get(type) || []) listener(event)
  }

  close(code?: number, reason?: string) {
    this.closeCode = code
    this.closeReason = reason
    this.readyState = 3
    this.emit('close')
  }
}

async function flushMessageQueue() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('builds the authenticated WebSocket URL with only the current token', () => {
  const result = new URL(createPaymentWebSocketUrl(
    'wss://www.bigtktool.shop/ws?Authorization=stale&roomId=7',
    ' token/value ',
  ))

  assert.equal(result.protocol, 'wss:')
  assert.equal(result.pathname, '/ws')
  assert.deepEqual([...result.searchParams.entries()], [['Authorization', 'token/value']])
})

test('rejects missing credentials and non-WebSocket transports', () => {
  assert.throws(() => createPaymentWebSocketUrl('https://example.com/ws', 'token'), /ws:\/\/ or wss:\/\//)
  assert.throws(() => createPaymentWebSocketUrl('wss://example.com/ws', ' '), /Payment token is required/)
})

test('decodes and parses the backend array-frame format', async () => {
  const raw = JSON.stringify([{ cmd: 2, data: 1_789_000_000 }, { cmd: 40, data: {} }])
  const encoded = new TextEncoder().encode(raw)

  assert.equal(await decodePaymentSocketMessage(encoded), raw)
  assert.deepEqual(parsePaymentSocketFrames(raw).map((frame) => frame.cmd), [2, 40])
  assert.throws(() => parsePaymentSocketFrames('{"cmd":40}'), /must be an array/)
})

test('accepts cmd=40 only for the exact order and preserves Apifox fields', () => {
  const [frame] = parsePaymentSocketFrames(JSON.stringify([{
    cmd: 40,
    data: {
      gold: 1200,
      goldBalance: 8400,
      orderId: 'order-123',
      payChannel: 6,
      price: 9.99,
    },
  }]))

  assert.deepEqual(parseRechargeSuccessForOrder(frame!, 'order-123'), {
    gold: 1200,
    goldBalance: 8400,
    orderId: 'order-123',
    payChannel: 6,
    price: 9.99,
  })
  assert.equal(parseRechargeSuccessForOrder(frame!, 'order-456'), undefined)
})

test('rejects malformed cmd=40 data instead of showing a false success', () => {
  assert.throws(() => parseRechargeSuccessPush({
    cmd: 40,
    data: {
      gold: 1200,
      goldBalance: 8400,
      orderId: '',
      payChannel: 256,
      price: 9.99,
    },
  }), /orderId is required/)
})

test('the live subscription ignores another order and completes on the expected order', async () => {
  const socket = new FakeWebSocket()
  const received: Array<{ orderId: string; goldBalance: number }> = []
  const subscription = subscribeToRechargeSuccess({
    url: 'wss://www.bigtktool.shop/ws',
    token: 'token',
    orderId: 'current-order',
    createSocket: () => socket as unknown as WebSocket,
    onSuccess(data) {
      received.push({ orderId: data.orderId, goldBalance: data.goldBalance })
    },
  })

  socket.emit('open')
  socket.emit('message', { data: JSON.stringify([{
    cmd: 40,
    data: { gold: 100, goldBalance: 900, orderId: 'another-order', payChannel: 1, price: 1 },
  }]) })
  await flushMessageQueue()
  assert.deepEqual(received, [])

  socket.emit('message', { data: JSON.stringify([{
    cmd: 40,
    data: { gold: 200, goldBalance: 1100, orderId: 'current-order', payChannel: 1, price: 2 },
  }]) })
  await flushMessageQueue()
  assert.deepEqual(received, [{ orderId: 'current-order', goldBalance: 1100 }])
  assert.equal(socket.closeCode, 1000)
  assert.equal(socket.closeReason, 'payment-status-received')

  subscription.close()
})
