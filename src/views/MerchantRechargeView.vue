<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '../api/http'
import { merchantApi } from '../api/merchant'
import { isMerchantPayProfileEmpty } from '../api/merchantProfile'
import { clearMerchantSession, readMerchantSession, type MerchantSession } from '../api/merchantAuth'
import { getProviderUrl, normalizeCurrencies } from '../api/recharge'
import type {
  CoinMerchantRechargeConfig,
  FiatCurrency,
  MerchantTransferRecordItem,
  MerchantTransferResponse,
  MerchantUserInfoResponse,
  RechargeOrderListResponse,
} from '../types/api'
import { currencySymbols, formatMoney } from '../utils/locale'
import {
  subscribeToRechargeSuccess,
  type PaymentSocketConnectionState,
  type PaymentStatusSocketSubscription,
  type RechargeSuccessPushData,
} from '../utils/paymentStatusSocket'
import {
  formatTransferRecordAmount,
  formatTransferRecordTime,
  transferRecordRecipient,
  transferRecordRecipientId,
} from '../utils/transferRecordPresentation'

type MerchantTab = 'transfer' | 'recharge' | 'history'
type RechargeState = 'pending' | 'success' | 'failed'
type PaymentFailureKind = 'expired' | 'failed'

const router = useRouter()
const session = ref<MerchantSession | null>(null)
const activeTab = ref<MerchantTab>('transfer')
const configs = ref<CoinMerchantRechargeConfig[]>([])
const currencies = ref<FiatCurrency[]>([])
const selectedPlanId = ref<string | number>('')
const selectedCurrency = ref('')
const loading = ref(false)
const submitting = ref(false)
const transferSubmitting = ref(false)
const errorMessage = ref('')
const transferError = ref('')
const balanceError = ref('')
const balanceLoading = ref(false)
const goldBalance = ref<number | null>(null)
const merchantUserId = ref<number | string | null>(null)
const merchantIdCopyState = ref<'idle' | 'copied' | 'failed'>('idle')
const targetUserId = ref('')
const transferAmount = ref('')
const transferResult = ref<MerchantTransferResponse | null>(null)
const recipientUser = ref<MerchantUserInfoResponse | null>(null)
const recipientResolvedUserId = ref('')
const recipientLookupLoading = ref(false)
const recipientLookupError = ref('')
const recipientAvatarFailed = ref(false)
const transferRecords = ref<MerchantTransferRecordItem[]>([])
const transferRecordPage = ref(1)
const transferRecordTotal = ref<number | null>(null)
const transferRecordLoading = ref(false)
const transferRecordError = ref('')
const orderId = ref('')
const orderState = ref<RechargeState | ''>('')
const failureKind = ref<PaymentFailureKind>()
const orderMessage = ref('')
const orderChecking = ref(false)
const socketMessage = ref('')
const socketState = ref<PaymentSocketConnectionState>('offline')
const failedCurrencyIcons = ref<Record<string, boolean>>({})
let socketSubscription: PaymentStatusSocketSubscription | undefined
let paymentWindow: Window | null = null
let transferRecordRequestId = 0
let recipientLookupRequestId = 0
let recipientLookupTimer: number | undefined
let merchantIdCopyResetTimer: number | undefined

const transferRecordPageSize = 20

const merchantName = computed(() => session.value?.username || session.value?.merchantId || 'Coin merchant')
const merchantIdCopyAction = computed(() => {
  if (merchantIdCopyState.value === 'copied') return 'Copied'
  if (merchantIdCopyState.value === 'failed') return 'Copy failed'
  return 'Copy'
})
const hasRecipientUserId = computed(() => Boolean(targetUserId.value.trim()))
const recipientLoaded = computed(() => Boolean(
  recipientUser.value
  && targetUserId.value.trim()
  && targetUserId.value.trim() === recipientResolvedUserId.value,
))
const recipientDisplayUserId = computed(() => {
  const responseUserId = recipientUser.value?.userId
  if (responseUserId === undefined || responseUserId === null || String(responseUserId).trim() === '') {
    return recipientResolvedUserId.value
  }
  return String(responseUserId).trim()
})
const recipientName = computed(() => {
  const nickname = recipientUser.value?.nickname
  return typeof nickname === 'string' && nickname.trim() ? nickname.trim() : 'Unnamed user'
})
const recipientInitial = computed(() => Array.from(recipientName.value)[0]?.toUpperCase() || '?')
const recipientAvatarUrl = computed(() => {
  if (recipientAvatarFailed.value) return ''
  const avatar = recipientUser.value?.avatar
  if (typeof avatar !== 'string') return ''
  const normalized = avatar.trim()
  return /^https:\/\//i.test(normalized) ? normalized : ''
})
const recipientPrettyId = computed(() => {
  const prettyId = recipientUser.value?.prettyId
  const normalized = prettyId === undefined || prettyId === null ? '' : String(prettyId).trim()
  return normalized && normalized !== '0' && normalized !== recipientDisplayUserId.value ? normalized : ''
})
const recipientVipLevel = computed(() => {
  const level = numeric(recipientUser.value?.vipLevel)
  return level !== null && Number.isInteger(level) && level > 0 ? level : null
})
const availableCurrencies = computed(() => {
  const seen = new Set<string>()
  return currencies.value
    .map((item) => String(item.currencyCode || '').trim())
    .filter((currency) => {
      const key = currency.toUpperCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
})
const selectedPlan = computed(() => configs.value.find((item) => String(item.id) === String(selectedPlanId.value)))
const transferRecordPageCount = computed(() => transferRecordTotal.value === null
  ? null
  : Math.max(1, Math.ceil(transferRecordTotal.value / transferRecordPageSize)))
const canLoadPreviousTransferRecords = computed(() => transferRecordPage.value > 1 && !transferRecordLoading.value)
const canLoadNextTransferRecords = computed(() => {
  if (transferRecordLoading.value) return false
  if (transferRecordTotal.value === null) return transferRecords.value.length === transferRecordPageSize
  return transferRecordPage.value * transferRecordPageSize < transferRecordTotal.value
})
const orderStatusTitle = computed(() => {
  if (orderState.value === 'success') return 'Recharge successful'
  if (orderState.value === 'failed') {
    return failureKind.value === 'expired' ? 'Payment expired' : 'Payment failed'
  }
  return 'Waiting for payment'
})
const socketStatusLabel = computed(() => {
  if (socketState.value === 'connected') return 'Live updates connected'
  if (socketState.value === 'connecting') return 'Connecting live updates…'
  if (socketState.value === 'reconnecting') return 'Reconnecting live updates…'
  return 'Live updates offline'
})

function numeric(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeMerchantUserId(value: unknown) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized) || /^0+$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) ? parsed : normalized
}

function resetMerchantIdCopyFeedback() {
  if (merchantIdCopyResetTimer !== undefined) window.clearTimeout(merchantIdCopyResetTimer)
  merchantIdCopyResetTimer = undefined
  merchantIdCopyState.value = 'idle'
}

async function writeClipboardText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall back for browsers that expose the Clipboard API but deny access.
    }
  }

  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  input.style.pointerEvents = 'none'
  document.body.appendChild(input)
  input.select()
  input.setSelectionRange(0, input.value.length)
  try {
    return document.execCommand('copy')
  } finally {
    input.remove()
  }
}

async function copyMerchantUserId() {
  if (merchantUserId.value === null) return
  resetMerchantIdCopyFeedback()
  try {
    merchantIdCopyState.value = await writeClipboardText(String(merchantUserId.value)) ? 'copied' : 'failed'
  } catch {
    merchantIdCopyState.value = 'failed'
  }
  merchantIdCopyResetTimer = window.setTimeout(resetMerchantIdCopyFeedback, 1800)
}

function planGold(plan: CoinMerchantRechargeConfig) {
  const value = numeric(plan.gold)
  return value === null ? '—' : value.toLocaleString()
}

function planPrice(plan: CoinMerchantRechargeConfig) {
  return formatMoney(numeric(plan.price) ?? undefined, 'USD')
}

function currencySymbol(currency: string) {
  const metadata = currencies.value.find((item) => String(item.currencyCode || '').toUpperCase() === currency.toUpperCase())
  return metadata?.symbol || currencySymbols[currency.toUpperCase()] || currency.slice(0, 1)
}

function currencyIcon(currency: string) {
  const key = currency.toUpperCase()
  if (failedCurrencyIcons.value[key]) return ''
  const metadata = currencies.value.find((item) => String(item.currencyCode || '').toUpperCase() === key)
  const icon = typeof metadata?.icon === 'string' ? metadata.icon.trim() : ''
  return /^https:\/\//i.test(icon) ? icon : ''
}

function markCurrencyIconFailed(currency: string) {
  failedCurrencyIcons.value = {
    ...failedCurrencyIcons.value,
    [currency.toUpperCase()]: true,
  }
}

function isTokenError(error: unknown) {
  if (!(error instanceof ApiError)) return false
  if (error.status === 401) return true
  if (!error.payload || typeof error.payload !== 'object') return false
  const code = (error.payload as Record<string, unknown>).code
  return code === 3 || code === '3'
}

function expireSession() {
  transferRecordRequestId += 1
  stopRecipientLookup()
  stopRechargeStatusSocket()
  closePaymentWindow()
  clearMerchantSession()
  session.value = null
  router.replace('/')
}

function showError(error: unknown, fallback: string) {
  if (isTokenError(error)) {
    expireSession()
    return 'Merchant session expired. Please sign in again.'
  }
  return error instanceof ApiError ? error.message : (error as Error)?.message || fallback
}

function hasRecipientDetails(result: MerchantUserInfoResponse | null | undefined) {
  if (!result) return false
  const responseUserId = result.userId
  const hasUserId = typeof responseUserId === 'number'
    ? Number.isFinite(responseUserId) && responseUserId > 0
    : typeof responseUserId === 'string' && Boolean(responseUserId.trim()) && !/^0+$/.test(responseUserId.trim())
  const hasNickname = typeof result.nickname === 'string' && Boolean(result.nickname.trim())
  const hasAvatar = typeof result.avatar === 'string' && Boolean(result.avatar.trim())
  return hasUserId || hasNickname || hasAvatar
}

function clearRecipientLookupTimer() {
  if (recipientLookupTimer !== undefined) window.clearTimeout(recipientLookupTimer)
  recipientLookupTimer = undefined
}

function stopRecipientLookup() {
  clearRecipientLookupTimer()
  recipientLookupRequestId += 1
  recipientLookupLoading.value = false
}

function clearRecipientResult() {
  recipientUser.value = null
  recipientResolvedUserId.value = ''
  recipientLookupError.value = ''
  recipientAvatarFailed.value = false
}

async function loadRecipientUser(userId: string): Promise<boolean> {
  const activeSession = session.value
  if (!activeSession) {
    recipientLookupLoading.value = false
    return false
  }

  clearRecipientLookupTimer()
  const requestId = ++recipientLookupRequestId
  recipientLookupLoading.value = true
  recipientLookupError.value = ''
  recipientUser.value = null
  recipientResolvedUserId.value = ''
  recipientAvatarFailed.value = false

  try {
    const result = await merchantApi.getUserInfo(Number(userId), activeSession.token)
    if (requestId !== recipientLookupRequestId || session.value?.token !== activeSession.token) return false

    if (!hasRecipientDetails(result)) {
      throw new Error('User information was not found. Check the User ID and try again.')
    }

    recipientUser.value = result
    recipientResolvedUserId.value = userId
    return true
  } catch (error) {
    if (requestId !== recipientLookupRequestId) return false
    recipientLookupError.value = showError(error, 'Unable to find user information. Check the User ID and try again.')
    return false
  } finally {
    if (requestId === recipientLookupRequestId) recipientLookupLoading.value = false
  }
}

function scheduleRecipientLookup(value: string) {
  stopRecipientLookup()
  clearRecipientResult()
  transferError.value = ''
  transferResult.value = null

  if (!value.trim()) return
  const userId = value.trim()

  recipientLookupLoading.value = true
  recipientLookupTimer = window.setTimeout(() => {
    recipientLookupTimer = undefined
    void loadRecipientUser(userId)
  }, 400)
}

function retryRecipientLookup() {
  const userId = targetUserId.value.trim()
  if (userId) void loadRecipientUser(userId)
}

async function loadBalance() {
  const activeSession = session.value
  if (!activeSession) return
  balanceLoading.value = true
  balanceError.value = ''
  try {
    const result = await merchantApi.getBalance(activeSession.token)
    if (session.value?.token !== activeSession.token) return
    goldBalance.value = numeric(result.gold)
    merchantUserId.value = normalizeMerchantUserId(result.userId)
    resetMerchantIdCopyFeedback()
  } catch (error) {
    balanceError.value = showError(error, 'Unable to load merchant balance.')
  } finally {
    balanceLoading.value = false
  }
}

async function loadTransferRecords(page = transferRecordPage.value) {
  const activeSession = session.value
  if (!activeSession) return

  const requestedPage = Math.max(1, Math.trunc(page))
  const requestId = ++transferRecordRequestId
  transferRecordLoading.value = true
  transferRecordError.value = ''
  try {
    const result = await merchantApi.getTransferRecords({
      pageIndex: requestedPage,
      pageSize: transferRecordPageSize,
    }, activeSession.token)
    if (requestId !== transferRecordRequestId || session.value?.token !== activeSession.token) return
    transferRecords.value = Array.isArray(result.list)
      ? result.list.filter((item): item is MerchantTransferRecordItem => Boolean(item && typeof item === 'object'))
      : []
    const total = numeric(result.total)
    const responsePage = numeric(result.pageIndex)
    transferRecordTotal.value = total !== null && total >= 0 ? Math.trunc(total) : null
    transferRecordPage.value = responsePage !== null && responsePage >= 1 ? Math.trunc(responsePage) : requestedPage
  } catch (error) {
    if (requestId !== transferRecordRequestId) return
    transferRecordError.value = showError(error, 'Unable to load transfer history.')
  } finally {
    if (requestId === transferRecordRequestId) transferRecordLoading.value = false
  }
}

function openTransferRecords() {
  activeTab.value = 'history'
  void loadTransferRecords(1)
}

async function loadPortal() {
  if (!session.value) return
  loading.value = true
  errorMessage.value = ''
  const [configResult, currencyResult] = await Promise.allSettled([
    merchantApi.getConfigs(session.value.token),
    merchantApi.getPaymentRegions(session.value.token),
    loadBalance(),
  ])
  if (!session.value) return
  try {
    if (configResult.status === 'rejected') throw configResult.reason
    configs.value = [...(configResult.value?.list || [])]
      .filter((item) => item && item.id !== undefined && item.id !== null)
      .sort((a, b) => Number(a.id) - Number(b.id))
    selectedPlanId.value = configs.value[0]?.id ?? ''
    if (currencyResult.status === 'rejected') {
      errorMessage.value = showError(currencyResult.reason, 'Unable to load payment currencies.')
      return
    }
    currencies.value = normalizeCurrencies(currencyResult.value)
    failedCurrencyIcons.value = {}
    selectedCurrency.value = availableCurrencies.value[0] || ''
    if (!configs.value.length) errorMessage.value = 'No coin-merchant recharge packages are available.'
    else if (!availableCurrencies.value.length) errorMessage.value = 'No payment currencies are available.'
  } catch (error) {
    errorMessage.value = showError(error, 'Unable to load coin-merchant recharge packages.')
  } finally {
    loading.value = false
  }
}

async function initializePortal() {
  if (!session.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const profile = await merchantApi.getPayProfile(session.value.token)
    if (isMerchantPayProfileEmpty(profile)) {
      await router.replace({ path: '/merchant/profile', query: { next: '/merchant/recharge' } })
      return
    }
  } catch (error) {
    errorMessage.value = showError(error, 'Unable to check payer profile. Please try again.')
    loading.value = false
    return
  }
  await loadPortal()
}

function openPaymentWindow() {
  const popup = window.open('about:blank', '_blank')
  if (popup) {
    try {
      popup.opener = null
      popup.document.title = 'Secure payment'
      popup.document.body.textContent = 'Preparing secure payment…'
      popup.document.body.style.cssText = 'margin:0;display:grid;place-items:center;min-height:100vh;background:#07111f;color:#c9d7e8;font:16px system-ui,sans-serif;'
    } catch {
      // Navigation below still has a top-level fallback if the popup is no
      // longer controllable because of a browser policy.
    }
  }
  return popup
}

function closePaymentWindow() {
  if (paymentWindow && !paymentWindow.closed) paymentWindow.close()
  paymentWindow = null
}

function navigateToProvider(url: string) {
  if (paymentWindow && !paymentWindow.closed) {
    try {
      paymentWindow.location.replace(url)
      paymentWindow = null
      return
    } catch {
      paymentWindow = null
    }
  }
  window.location.assign(url)
}

function stopRechargeStatusSocket() {
  socketSubscription?.close()
  socketSubscription = undefined
}

function responseContainsOrder(response: RechargeOrderListResponse, expectedOrderId: string) {
  return (response.list || []).some((order) => String(order.id ?? '').trim() === expectedOrderId)
}

async function findFailureState(token: string, expectedOrderId: string): Promise<PaymentFailureKind | undefined> {
  const [expiredOrders, failedOrders] = await Promise.all([
    merchantApi.getRechargeOrdersByStatus(3, token),
    merchantApi.getRechargeOrdersByStatus(4, token),
  ])
  if (responseContainsOrder(failedOrders, expectedOrderId)) return 'failed'
  if (responseContainsOrder(expiredOrders, expectedOrderId)) return 'expired'
  return undefined
}

async function markRechargeSuccess(result: {
  gold: RechargeSuccessPushData['gold'] | null
  goldBalance: RechargeSuccessPushData['goldBalance'] | null
}) {
  if (orderState.value === 'success') return
  const creditedGold = typeof result.gold === 'number' ? result.gold : null
  orderState.value = 'success'
  failureKind.value = undefined
  orderMessage.value = `Added ${creditedGold?.toLocaleString() || 'the configured amount'} coins to the merchant wallet.`
  socketMessage.value = ''
  if (typeof result.goldBalance === 'number') goldBalance.value = result.goldBalance
  stopRechargeStatusSocket()
  await loadBalance()
}

function isRechargeSuccessful() {
  return orderState.value === 'success'
}

async function checkRechargeOrder() {
  const activeSession = session.value
  const expectedOrderId = orderId.value
  if (!activeSession || !expectedOrderId || orderChecking.value || isRechargeSuccessful()) return
  orderChecking.value = true
  try {
    const result = await merchantApi.checkRecharge(expectedOrderId, activeSession.token)
    if (expectedOrderId !== orderId.value || !session.value) return
    if (result.success) {
      await markRechargeSuccess({
        gold: typeof result.gold === 'number' ? result.gold : null,
        goldBalance: typeof result.goldBalance === 'number' ? result.goldBalance : null,
      })
      return
    }

    const terminalFailure = await findFailureState(activeSession.token, expectedOrderId)
    if (expectedOrderId !== orderId.value || isRechargeSuccessful()) return
    if (terminalFailure) {
      orderState.value = 'failed'
      failureKind.value = terminalFailure
      orderMessage.value = terminalFailure === 'expired'
        ? 'The payment timed out or was cancelled before it could be completed.'
        : 'The payment provider could not complete this payment. No coins were added.'
    } else {
      orderState.value = 'pending'
      failureKind.value = undefined
      orderMessage.value = 'Payment has not been confirmed yet. Keep this page open.'
    }
  } catch (error) {
    if (expectedOrderId !== orderId.value || isRechargeSuccessful()) return
    if (isTokenError(error)) {
      orderState.value = 'failed'
      failureKind.value = 'failed'
      orderMessage.value = showError(error, 'Unable to check the recharge order.')
      stopRechargeStatusSocket()
    } else if (orderState.value !== 'failed') {
      // A temporary status failure must not be treated as a failed payment.
      orderState.value = 'pending'
      failureKind.value = undefined
      orderMessage.value = error instanceof ApiError
        ? error.message
        : (error as Error)?.message || 'Unable to check the order right now.'
    }
  } finally {
    const orderChanged = expectedOrderId !== orderId.value
    orderChecking.value = false
    if (orderChanged && orderId.value && !isRechargeSuccessful()) void checkRechargeOrder()
  }
}

function startRechargeStatusSocket(expectedOrderId: string) {
  stopRechargeStatusSocket()
  const activeSession = session.value
  if (!activeSession) return
  socketMessage.value = ''
  socketState.value = 'offline'
  try {
    socketSubscription = subscribeToRechargeSuccess({
      url: import.meta.env.VITE_WEBSOCKET_URL || '',
      token: activeSession.token,
      orderId: expectedOrderId,
      onSuccess(result) {
        if (orderId.value === expectedOrderId) void markRechargeSuccess(result)
      },
      onConnectionChange(state) {
        if (orderId.value !== expectedOrderId) return
        socketState.value = state
        if (state === 'connected') socketMessage.value = ''
      },
      onError(error) {
        if (orderId.value === expectedOrderId) {
          socketMessage.value = error.message || 'Live payment updates are temporarily unavailable.'
        }
      },
    })
  } catch (error) {
    socketState.value = 'offline'
    socketMessage.value = error instanceof Error
      ? error.message
      : 'Live payment updates are unavailable.'
  }
}

async function submitRecharge() {
  if (!session.value || !selectedPlan.value || submitting.value) return
  if (!selectedCurrency.value) {
    errorMessage.value = 'Select an available payment currency.'
    return
  }
  const cfgId = Number(selectedPlan.value.id)
  if (!Number.isSafeInteger(cfgId) || cfgId < 0) {
    errorMessage.value = 'The selected recharge package has an invalid ID.'
    return
  }
  submitting.value = true
  errorMessage.value = ''
  orderId.value = ''
  orderState.value = ''
  failureKind.value = undefined
  orderMessage.value = ''
  socketMessage.value = ''
  socketState.value = 'offline'
  stopRechargeStatusSocket()
  closePaymentWindow()
  try {
    paymentWindow = openPaymentWindow()
    const result = await merchantApi.createRecharge({ cfgId, currencyCode: selectedCurrency.value }, session.value.token)
    const raw = result as Record<string, unknown>
    const createdOrderId = raw.orderId ?? raw.order_id ?? raw.tradeNo
    if (createdOrderId === undefined || createdOrderId === null || String(createdOrderId).trim() === '') {
      throw new Error('The recharge API did not return an order ID.')
    }
    orderId.value = String(createdOrderId)
    orderState.value = 'pending'
    startRechargeStatusSocket(orderId.value)
    const providerUrl = getProviderUrl(result)
    if (providerUrl) navigateToProvider(providerUrl)
    else {
      closePaymentWindow()
      orderMessage.value = 'Order created. Waiting for the payment provider to confirm it.'
    }
    void checkRechargeOrder()
  } catch (error) {
    closePaymentWindow()
    errorMessage.value = showError(error, 'Unable to create the merchant recharge order.')
  } finally {
    submitting.value = false
  }
}

function parseTransferAmount() {
  const raw = transferAmount.value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error('Enter a positive amount with at most 2 decimal places.')
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < 0.01 || !Number.isSafeInteger(Math.round(amount * 100))) {
    throw new Error('Transfer amount must be at least 0.01.')
  }
  return amount
}

async function submitTransfer() {
  if (!session.value || transferSubmitting.value) return
  const target = targetUserId.value.trim()
  if (!target) {
    transferError.value = 'Enter the user ID that should receive the coins.'
    return
  }
  let amount: number
  try {
    amount = parseTransferAmount()
  } catch (error) {
    transferError.value = (error as Error).message
    return
  }
  transferSubmitting.value = true
  transferError.value = ''
  transferResult.value = null
  try {
    transferResult.value = await merchantApi.transferGold({ targetUserId: target, amount }, session.value.token)
    transferAmount.value = ''
    await loadBalance()
  } catch (error) {
    transferError.value = showError(error, 'Unable to transfer coins.')
  } finally {
    transferSubmitting.value = false
  }
}

function logout() {
  transferRecordRequestId += 1
  stopRecipientLookup()
  stopRechargeStatusSocket()
  closePaymentWindow()
  clearMerchantSession()
  session.value = null
  router.replace('/')
}

function editProfile() {
  void router.push({ path: '/merchant/profile', query: { mode: 'edit', next: '/merchant/recharge' } })
}

function reconcileWhenActive() {
  if (document.visibilityState === 'visible') void checkRechargeOrder()
}

watch(targetUserId, scheduleRecipientLookup)

onMounted(() => {
  session.value = readMerchantSession()
  if (!session.value) {
    router.replace({ path: '/', query: { redirect: '/merchant/recharge' } })
    return
  }
  void initializePortal()
  window.addEventListener('focus', reconcileWhenActive)
  window.addEventListener('online', reconcileWhenActive)
  document.addEventListener('visibilitychange', reconcileWhenActive)
})

onUnmounted(() => {
  transferRecordRequestId += 1
  resetMerchantIdCopyFeedback()
  stopRecipientLookup()
  stopRechargeStatusSocket()
  closePaymentWindow()
  window.removeEventListener('focus', reconcileWhenActive)
  window.removeEventListener('online', reconcileWhenActive)
  document.removeEventListener('visibilitychange', reconcileWhenActive)
})
</script>

<template>
  <main class="page-shell merchant-shell">
    <header class="topbar merchant-topbar">
      <div class="brand-mark"><span class="brand-dot" /> Coin merchant <small>PORTAL</small></div>
      <div class="merchant-account"><span>{{ merchantName }}</span><button class="logout-button" @click="editProfile">Edit profile</button><button class="logout-button" @click="logout">Sign out</button></div>
    </header>

    <section class="merchant-layout">
      <div class="merchant-intro">
        <p class="eyebrow">COIN MERCHANT PORTAL</p>
        <h1>Fund your wallet, then send coins.</h1>
        <p class="subtitle">Recharge the signed-in merchant wallet through YHPAY or transfer gold to a user. The server remains authoritative for balances and order status.</p>
        <div class="merchant-notice"><span>↯</span><div><strong>Two protected actions</strong><p>Recharge uses the coin-merchant package contract. Transfers are validated by the backend and return both wallet balances.</p></div></div>
      </div>

      <div class="merchant-card">
        <div class="merchant-balance-card">
          <div class="merchant-balance-summary">
            <span class="card-label">MERCHANT BALANCE</span>
            <strong v-if="!balanceLoading">{{ goldBalance?.toLocaleString() ?? '—' }}</strong><strong v-else>Loading…</strong>
            <span>Gold coins</span>
            <button
              v-if="merchantUserId !== null"
              class="merchant-id-copy"
              :data-state="merchantIdCopyState"
              type="button"
              :aria-label="merchantIdCopyState === 'copied' ? `Merchant ID ${merchantUserId} copied` : `Copy merchant ID ${merchantUserId}`"
              @click="copyMerchantUserId"
            >
              <span>Merchant ID</span><strong>{{ merchantUserId }}</strong><small aria-live="polite">{{ merchantIdCopyAction }}</small>
            </button>
          </div>
          <button class="merchant-history-entry" :class="{ selected: activeTab === 'history' }" type="button" @click="openTransferRecords">
            <span class="card-label">TRANSFER RECORDS</span><strong>Transfer history</strong><span>View records →</span>
          </button>
          <button class="balance-refresh" type="button" :disabled="balanceLoading" @click="loadBalance">↻</button>
        </div>
        <p v-if="balanceError" class="inline-error merchant-error">{{ balanceError }}</p>

        <div class="merchant-tabs" role="tablist" aria-label="Merchant actions">
          <button type="button" role="tab" :aria-selected="activeTab === 'transfer'" :class="{ selected: activeTab === 'transfer' }" @click="activeTab = 'transfer'">Transfer coins</button>
          <button type="button" role="tab" :aria-selected="activeTab === 'recharge'" :class="{ selected: activeTab === 'recharge' }" @click="activeTab = 'recharge'">Recharge wallet</button>
        </div>

        <template v-if="activeTab === 'recharge'">
          <div class="card-heading"><div><span class="card-label">1. PACKAGE</span><h2>Merchant recharge</h2></div><span class="step-count">{{ configs.length }} packages</span></div>
          <p class="merchant-contract-note">Prices are the USD values from the coin-merchant catalog. Payment regions are loaded from HaiPay.</p>
          <div class="currency-list">
            <button v-for="currency in availableCurrencies" :key="currency" type="button" class="currency-pill" :class="{ selected: selectedCurrency === currency }" @click="selectedCurrency = currency">
              <img v-if="currencyIcon(currency)" class="currency-flag" :src="currencyIcon(currency)" alt="" width="22" height="16" @error="markCurrencyIconFailed(currency)" />
              <span v-else class="currency-symbol">{{ currencySymbol(currency) }}</span>{{ currency }}<span v-if="selectedCurrency === currency" class="check">✓</span>
            </button>
          </div>

          <div v-if="loading" class="loading-state merchant-loading"><div class="skeleton" /><div class="skeleton" /></div>
          <div v-else-if="configs.length" class="plans-grid merchant-plans-grid">
            <button v-for="plan in configs" :key="plan.id" type="button" class="plan-card" :class="{ selected: String(selectedPlanId) === String(plan.id) }" @click="selectedPlanId = plan.id">
              <span class="plan-name">{{ plan.name || `Package ${plan.id}` }}</span>
              <strong class="plan-price">{{ planPrice(plan) }}</strong>
              <span class="plan-gold">{{ planGold(plan) }} coins</span>
              <span v-if="String(selectedPlanId) === String(plan.id)" class="plan-check">✓</span>
            </button>
          </div>

          <div v-if="selectedPlan" class="order-summary"><div><span>Package</span><strong>{{ selectedPlan.name || `Package ${selectedPlan.id}` }}</strong></div><div><span>Credits</span><strong>{{ planGold(selectedPlan) }} coins</strong></div><div><span>Price</span><strong>{{ planPrice(selectedPlan) }}</strong></div></div>
          <p v-if="errorMessage" class="inline-error merchant-error">{{ errorMessage }}</p>
          <button class="primary-button" :disabled="loading || submitting || !selectedPlan || !selectedCurrency" @click="submitRecharge"><span v-if="submitting" class="spinner" />{{ submitting ? 'Creating order…' : 'Recharge merchant wallet' }}<span v-if="!submitting">→</span></button>

          <section v-if="orderId" class="merchant-order-status" :class="`status-${orderState}`">
            <div class="status-heading"><span class="status-dot" /><strong>{{ orderStatusTitle }}</strong><span class="socket-label" :data-state="socketState">{{ orderChecking ? 'Checking…' : orderState === 'success' ? 'Confirmed' : orderState === 'failed' ? 'Final status' : socketStatusLabel }}</span></div>
            <p>Order: {{ orderId }}</p><p>{{ orderMessage }}</p>
            <p v-if="orderState === 'pending' && socketMessage" class="socket-message">{{ socketMessage }}</p>
            <button v-if="orderState !== 'success'" class="secondary-button" :disabled="orderChecking" @click="checkRechargeOrder">{{ orderChecking ? 'Checking…' : 'Check now' }}</button>
          </section>
        </template>

        <template v-else-if="activeTab === 'transfer'">
          <div class="card-heading"><div><span class="card-label">1. RECIPIENT</span><h2>Transfer gold coins</h2></div><span class="step-count">{{ recipientLoaded ? 'User details loaded' : 'Backend lookup' }}</span></div>
          <form class="merchant-transfer-form" @submit.prevent="submitTransfer">
            <label for="recipient-user-id">User ID<input id="recipient-user-id" v-model="targetUserId" autocomplete="off" placeholder="Enter recipient user ID" aria-describedby="recipient-lookup-status" /></label>
            <div id="recipient-lookup-status" class="merchant-recipient-feedback" aria-live="polite">
              <div v-if="recipientLookupLoading" class="merchant-recipient-card merchant-recipient-loading" role="status">
                <span class="spinner" aria-hidden="true" />
                <span>Checking user information…</span>
              </div>
              <section v-else-if="recipientLoaded" class="merchant-recipient-card merchant-recipient-loaded">
                <img v-if="recipientAvatarUrl" class="merchant-recipient-avatar" :src="recipientAvatarUrl" alt="" width="48" height="48" @error="recipientAvatarFailed = true" />
                <span v-else class="merchant-recipient-avatar merchant-recipient-avatar-fallback" aria-hidden="true">{{ recipientInitial }}</span>
                <div class="merchant-recipient-copy">
                  <span class="card-label">RECIPIENT DETAILS</span>
                  <strong>{{ recipientName }}</strong>
                  <div class="merchant-recipient-meta">
                    <span>User ID {{ recipientDisplayUserId }}</span>
                    <span v-if="recipientPrettyId">Pretty ID {{ recipientPrettyId }}</span>
                    <span v-if="recipientVipLevel !== null">VIP {{ recipientVipLevel }}</span>
                    <span v-if="recipientUser?.isAnchor">Anchor</span>
                  </div>
                </div>
              </section>
              <div v-else-if="recipientLookupError" class="merchant-recipient-error" role="alert">
                <p class="inline-error">{{ recipientLookupError }}</p>
                <button v-if="hasRecipientUserId" type="button" @click="retryRecipientLookup">Try again</button>
              </div>
            </div>
            <label>Amount<input v-model="transferAmount" inputmode="decimal" autocomplete="off" placeholder="0.00" /></label>
            <p class="merchant-contract-note">Minimum 0.01 gold; at most 2 decimal places.</p>
            <p v-if="transferError" class="inline-error merchant-error">{{ transferError }}</p>
            <button class="primary-button" type="submit" :disabled="transferSubmitting"><span v-if="transferSubmitting" class="spinner" />{{ transferSubmitting ? 'Transferring…' : 'Confirm transfer' }}<span v-if="!transferSubmitting">→</span></button>
          </form>
          <section v-if="transferResult" class="merchant-transfer-result">
            <div class="status-heading"><span class="status-dot" /><strong>Transfer complete</strong></div>
            <p>{{ numeric(transferResult.amount)?.toLocaleString() ?? '—' }} coins sent to user {{ transferResult.targetUserId || targetUserId }}.</p>
            <div class="order-summary"><div><span>Your gold balance</span><strong>{{ numeric(transferResult.senderGold)?.toLocaleString() ?? '—' }}</strong></div><div><span>Recipient gold balance</span><strong>{{ numeric(transferResult.targetUserGold)?.toLocaleString() ?? '—' }}</strong></div></div>
          </section>
        </template>

        <template v-else>
          <div class="card-heading merchant-history-heading">
            <div><span class="card-label">TRANSFER RECORDS</span><h2>Transfer history</h2></div>
            <button class="secondary-button" type="button" :disabled="transferRecordLoading" @click="loadTransferRecords()">{{ transferRecordLoading ? 'Loading…' : 'Refresh' }}</button>
          </div>
          <p class="merchant-contract-note">Gold transfers sent from this merchant account.</p>

          <div v-if="transferRecordLoading" class="loading-state merchant-loading"><div class="skeleton" /><div class="skeleton" /></div>
          <section v-else-if="transferRecordError" class="merchant-history-state">
            <p class="inline-error merchant-error">{{ transferRecordError }}</p>
            <button class="secondary-button" type="button" @click="loadTransferRecords()">Try again</button>
          </section>
          <div v-else-if="transferRecords.length" class="merchant-history-list">
            <article v-for="(item, index) in transferRecords" :key="String(item.id ?? `${transferRecordPage}-${index}`)" class="merchant-history-item">
              <div class="merchant-history-copy">
                <strong>{{ transferRecordRecipient(item) }}</strong>
                <span>{{ formatTransferRecordTime(item) }}</span>
                <small>{{ transferRecordRecipientId(item) }}</small>
              </div>
              <strong class="merchant-history-amount" data-direction="expense">{{ formatTransferRecordAmount(item.amount) }}<small>coins</small></strong>
            </article>
          </div>
          <section v-else class="merchant-history-state merchant-history-empty">
            <strong>No transfers yet</strong>
            <p>Transfers sent from this merchant account will appear here.</p>
          </section>

          <footer v-if="!transferRecordLoading && !transferRecordError && (transferRecords.length || transferRecordPage > 1)" class="merchant-history-pagination">
            <button class="secondary-button" type="button" :disabled="!canLoadPreviousTransferRecords" @click="loadTransferRecords(transferRecordPage - 1)">← Previous</button>
            <span>Page {{ transferRecordPage }}<template v-if="transferRecordPageCount"> of {{ transferRecordPageCount }}</template><small v-if="transferRecordTotal !== null">{{ transferRecordTotal }} records</small></span>
            <button class="secondary-button" type="button" :disabled="!canLoadNextTransferRecords" @click="loadTransferRecords(transferRecordPage + 1)">Next →</button>
          </footer>
        </template>
      </div>
    </section>
  </main>
</template>
