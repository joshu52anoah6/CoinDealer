type RefreshAttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface BrowserClientVersionReloader {
  (): void
  markHealthy(): void
}

export interface BrowserClientVersionReloaderOptions {
  readonly key?: string
  readonly storage?: RefreshAttemptStorage
  readonly latestClientBaseUrl?: string
  readonly currentUrl?: () => string
  readonly createRefreshToken?: () => string
  readonly prepareServerRefresh?: (currentUrl: string) => Promise<void>
  readonly preparationTimeoutMs?: number
  readonly replace?: (url: string) => void
}

const defaultRefreshAttemptKey = 'coin-dealer-client-version-refresh-attempted'
const refreshQueryKey = '__coin_dealer_refresh'
const defaultPreparationTimeoutMs = 1_500

function createDefaultRefreshToken() {
  const randomId = globalThis.crypto?.randomUUID?.()
  return randomId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readLatestClientBaseUrl(value: string | undefined) {
  const normalized = value?.trim()
  if (!normalized) return undefined

  const url = new URL(normalized)
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new TypeError('The latest client base URL must be an HTTP(S) base URL without credentials, query, or hash.')
  }
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`
  return url
}

function createServerRefreshUrl(
  currentUrl: string,
  refreshToken: string,
  latestClientBaseUrl: URL | undefined,
) {
  const current = new URL(currentUrl)
  const target = latestClientBaseUrl
    ? new URL(current.pathname.replace(/^\/+/, ''), latestClientBaseUrl)
    : current
  target.search = current.search
  target.hash = current.hash
  target.searchParams.set(refreshQueryKey, refreshToken)
  return target.href
}

function registrationControlsUrl(scope: string, current: URL) {
  try {
    const registrationScope = new URL(scope)
    return registrationScope.origin === current.origin
      && current.pathname.startsWith(registrationScope.pathname)
  } catch {
    return false
  }
}

async function removeCachedClientCode(currentUrl: string) {
  const current = new URL(currentUrl)
  const serviceWorker = globalThis.navigator?.serviceWorker
  if (serviceWorker) {
    const registrations = await serviceWorker.getRegistrations()
    await Promise.allSettled(
      registrations
        .filter((registration) => registrationControlsUrl(registration.scope, current))
        .map((registration) => registration.unregister()),
    )
  }

  const cacheStorage = globalThis.caches
  if (!cacheStorage) return
  const cacheNames = await cacheStorage.keys()
  await Promise.allSettled(
    cacheNames
      .filter((cacheName) => cacheName.startsWith('workbox-precache'))
      .map((cacheName) => cacheStorage.delete(cacheName)),
  )
}

function prepareWithin(prepare: () => Promise<void>, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (timeout !== undefined) clearTimeout(timeout)
      timeout = undefined
      resolve()
    }
    timeout = setTimeout(finish, timeoutMs)
    void prepare().then(finish, finish)
  })
}

/** Allows one automatic server refresh per browser tab until the new client proves healthy. */
export function createBrowserClientVersionReloader(
  options: BrowserClientVersionReloaderOptions = {},
): BrowserClientVersionReloader {
  const key = options.key ?? defaultRefreshAttemptKey
  const latestClientBaseUrl = readLatestClientBaseUrl(options.latestClientBaseUrl)
  const preparationTimeoutMs = options.preparationTimeoutMs ?? defaultPreparationTimeoutMs
  if (!Number.isInteger(preparationTimeoutMs) || preparationTimeoutMs <= 0) {
    throw new TypeError('Client refresh preparation timeout must be a positive integer of milliseconds.')
  }
  let attemptedInThisRuntime = false

  const targetStorage = () => options.storage ?? globalThis.sessionStorage
  const currentUrl = options.currentUrl ?? (() => globalThis.location.href)
  const createRefreshToken = options.createRefreshToken ?? createDefaultRefreshToken
  const prepareServerRefresh = options.prepareServerRefresh ?? removeCachedClientCode
  const replace = options.replace ?? ((url: string) => globalThis.location.replace(url))

  const requestReload = () => {
    if (attemptedInThisRuntime) return
    attemptedInThisRuntime = true

    try {
      if (targetStorage().getItem(key) === '1') return
      targetStorage().setItem(key, '1')
    } catch {
      // The runtime guard still prevents a refresh storm when storage is unavailable.
    }

    const documentUrl = currentUrl()
    const refreshUrl = createServerRefreshUrl(
      documentUrl,
      createRefreshToken(),
      latestClientBaseUrl,
    )
    // Remove only code caches before loading the configured deployment. Business
    // storage, login state, and payment state remain intact.
    void prepareWithin(
      () => prepareServerRefresh(documentUrl),
      preparationTimeoutMs,
    ).then(() => replace(refreshUrl))
  }

  requestReload.markHealthy = () => {
    if (attemptedInThisRuntime) return
    try {
      targetStorage().removeItem(key)
    } catch {
      // Storage access is best-effort.
    }
  }

  return requestReload
}
