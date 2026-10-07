import assert from 'node:assert/strict'
import test from 'node:test'
import { createBrowserClientVersionReloader } from '../src/utils/clientVersionReloader.ts'

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

async function flushNavigation() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function createOptions(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  replacements: string[],
) {
  return {
    storage,
    replace: (url: string) => { replacements.push(url) },
    currentUrl: () => 'http://127.0.0.1:5173/?source=local#/merchant/recharge?currency=USD',
    createRefreshToken: () => 'server-refresh-1',
    prepareServerRefresh: async () => {},
  }
}

test('switches an outdated local client to the configured merchant deployment', async () => {
  const replacements: string[] = []
  const requestReload = createBrowserClientVersionReloader({
    ...createOptions(createMemoryStorage(), replacements),
    latestClientBaseUrl: 'https://coin-merchant.example/app/',
  })

  requestReload()
  await flushNavigation()

  assert.deepEqual(replacements, [
    'https://coin-merchant.example/app/?source=local&__coin_dealer_refresh=server-refresh-1#/merchant/recharge?currency=USD',
  ])
})

test('prepares browser code caches before replacing the current document', async () => {
  const sequence: string[] = []
  const requestReload = createBrowserClientVersionReloader({
    ...createOptions(createMemoryStorage(), []),
    prepareServerRefresh: async (currentUrl) => {
      assert.equal(currentUrl, 'http://127.0.0.1:5173/?source=local#/merchant/recharge?currency=USD')
      sequence.push('prepare')
    },
    replace: () => { sequence.push('replace') },
  })

  requestReload()
  await flushNavigation()

  assert.deepEqual(sequence, ['prepare', 'replace'])
})

test('removes only the current service worker and Workbox code caches', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const cachesDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches')
  let currentUnregisterCalls = 0
  let unrelatedUnregisterCalls = 0
  const deletedCaches: string[] = []

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        getRegistrations: async () => [
          {
            scope: 'http://127.0.0.1:5173/',
            unregister: async () => { currentUnregisterCalls += 1; return true },
          },
          {
            scope: 'http://127.0.0.1:5173/other/',
            unregister: async () => { unrelatedUnregisterCalls += 1; return true },
          },
        ],
      },
    },
  })
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      keys: async () => ['workbox-precache-v2-portal', 'coin-dealer-payment-state'],
      delete: async (name: string) => { deletedCaches.push(name); return true },
    },
  })

  try {
    const replacements: string[] = []
    const requestReload = createBrowserClientVersionReloader({
      ...createOptions(createMemoryStorage(), replacements),
      prepareServerRefresh: undefined,
    })

    requestReload()
    await flushNavigation()

    assert.equal(replacements.length, 1)
    assert.equal(currentUnregisterCalls, 1)
    assert.equal(unrelatedUnregisterCalls, 0)
    assert.deepEqual(deletedCaches, ['workbox-precache-v2-portal'])
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else Reflect.deleteProperty(globalThis, 'navigator')
    if (cachesDescriptor) Object.defineProperty(globalThis, 'caches', cachesDescriptor)
    else Reflect.deleteProperty(globalThis, 'caches')
  }
})

test('allows only one refresh until a later runtime proves the protected API is healthy', async () => {
  const storage = createMemoryStorage()
  const replacements: string[] = []
  const options = createOptions(storage, replacements)

  const firstRuntime = createBrowserClientVersionReloader(options)
  firstRuntime()
  firstRuntime()
  createBrowserClientVersionReloader(options)()
  await flushNavigation()
  assert.equal(replacements.length, 1)

  createBrowserClientVersionReloader(options).markHealthy()
  createBrowserClientVersionReloader(options)()
  await flushNavigation()
  assert.equal(replacements.length, 2)
})

test('does not clear the refresh guard after the same runtime observes code 153', async () => {
  const storage = createMemoryStorage()
  const replacements: string[] = []
  const options = createOptions(storage, replacements)
  const failingRuntime = createBrowserClientVersionReloader(options)

  failingRuntime()
  failingRuntime.markHealthy()
  createBrowserClientVersionReloader(options)()
  await flushNavigation()

  assert.equal(replacements.length, 1)
})
