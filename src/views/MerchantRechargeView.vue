<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '../api/http'
import { merchantApi } from '../api/merchant'
import { isMerchantPayProfileEmpty } from '../api/merchantProfile'
import { clearMerchantSession, readMerchantSession, type MerchantSession } from '../api/merchantAuth'
import { getProviderUrl, normalizeCurrencies, rechargeApi } from '../api/recharge'
import type { CoinMerchantRechargeConfig, FiatCurrency, MerchantTransferResponse } from '../types/api'
import { currencySymbols, formatMoney } from '../utils/locale'

type MerchantTab = 'recharge' | 'transfer'
type RechargeState = 'pending' | 'success' | 'failed'

const router = useRouter()
const session = ref<MerchantSession | null>(null)
const activeTab = ref<MerchantTab>('recharge')
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
const diamondBalance = ref<number | null>(null)
const targetUserId = ref('')
const transferAmount = ref('')
const transferResult = ref<MerchantTransferResponse | null>(null)
const orderId = ref('')
const orderState = ref<RechargeState | ''>('')
const orderMessage = ref('')
const orderChecking = ref(false)
const failedCurrencyIcons = ref<Record<string, boolean>>({})
let orderTimer: number | undefined
let paymentWindow: Window | null = null

const merchantName = computed(() => session.value?.username || session.value?.merchantId || 'Coin merchant')
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

function numeric(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
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
  stopOrderPolling()
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

async function loadBalance() {
  if (!session.value) return
  balanceLoading.value = true
  balanceError.value = ''
  try {
    const result = await merchantApi.getBalance(session.value.token)
    goldBalance.value = numeric(result.gold)
    diamondBalance.value = numeric(result.diamond)
  } catch (error) {
    balanceError.value = showError(error, 'Unable to load merchant balance.')
  } finally {
    balanceLoading.value = false
  }
}

async function loadPortal() {
  if (!session.value) return
  loading.value = true
  errorMessage.value = ''
  const [configResult, currencyResult] = await Promise.allSettled([
    merchantApi.getConfigs(session.value.token),
    rechargeApi.getCurrencies(0),
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

function stopOrderPolling() {
  if (orderTimer !== undefined) window.clearInterval(orderTimer)
  orderTimer = undefined
}

async function checkRechargeOrder() {
  if (!session.value || !orderId.value || orderChecking.value || orderState.value === 'success') return
  orderChecking.value = true
  try {
    const result = await merchantApi.checkRecharge(orderId.value, session.value.token)
    if (result.success) {
      orderState.value = 'success'
      orderMessage.value = `Added ${numeric(result.gold)?.toLocaleString() || 'the configured amount'} coins to the merchant wallet.`
      stopOrderPolling()
      await loadBalance()
    } else {
      orderState.value = 'pending'
      orderMessage.value = 'Payment has not been confirmed yet. Keep this page open.'
    }
  } catch (error) {
    if (isTokenError(error)) {
      orderState.value = 'failed'
      orderMessage.value = showError(error, 'Unable to check the recharge order.')
      stopOrderPolling()
    } else {
      // A temporary status failure must not be treated as a failed payment.
      orderMessage.value = error instanceof ApiError ? error.message : 'Unable to check the order right now. Retrying…'
    }
  } finally {
    orderChecking.value = false
  }
}

function startOrderPolling() {
  stopOrderPolling()
  void checkRechargeOrder()
  orderTimer = window.setInterval(checkRechargeOrder, 3000)
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
  orderMessage.value = ''
  stopOrderPolling()
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
    const providerUrl = getProviderUrl(result)
    if (providerUrl) navigateToProvider(providerUrl)
    else {
      closePaymentWindow()
      orderMessage.value = 'Order created. Waiting for the payment provider to confirm it.'
    }
    startOrderPolling()
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
  stopOrderPolling()
  closePaymentWindow()
  clearMerchantSession()
  session.value = null
  router.replace('/')
}

function editProfile() {
  void router.push({ path: '/merchant/profile', query: { mode: 'edit', next: '/merchant/recharge' } })
}

onMounted(() => {
  session.value = readMerchantSession()
  if (!session.value) {
    router.replace({ path: '/', query: { redirect: '/merchant/recharge' } })
    return
  }
  void initializePortal()
})

onUnmounted(() => {
  stopOrderPolling()
  closePaymentWindow()
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
          <div><span class="card-label">MERCHANT BALANCE</span><strong v-if="!balanceLoading">{{ goldBalance?.toLocaleString() ?? '—' }}</strong><strong v-else>Loading…</strong><span>Gold coins</span></div>
          <div><strong v-if="!balanceLoading">{{ diamondBalance?.toLocaleString() ?? '—' }}</strong><strong v-else>—</strong><span>Diamonds</span></div>
          <button class="balance-refresh" type="button" :disabled="balanceLoading" @click="loadBalance">↻</button>
        </div>
        <p v-if="balanceError" class="inline-error merchant-error">{{ balanceError }}</p>

        <div class="merchant-tabs" role="tablist" aria-label="Merchant actions">
          <button type="button" role="tab" :aria-selected="activeTab === 'recharge'" :class="{ selected: activeTab === 'recharge' }" @click="activeTab = 'recharge'">Recharge wallet</button>
          <button type="button" role="tab" :aria-selected="activeTab === 'transfer'" :class="{ selected: activeTab === 'transfer' }" @click="activeTab = 'transfer'">Transfer coins</button>
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
            <div class="status-heading"><span class="status-dot" /><strong>{{ orderState === 'success' ? 'Recharge successful' : orderState === 'failed' ? 'Recharge status unavailable' : 'Waiting for payment' }}</strong><span class="socket-label">{{ orderChecking ? 'Checking…' : orderState === 'success' ? 'Confirmed' : 'Polling every 3s' }}</span></div>
            <p>Order: {{ orderId }}</p><p>{{ orderMessage }}</p>
            <button v-if="orderState !== 'success'" class="secondary-button" :disabled="orderChecking" @click="checkRechargeOrder">{{ orderChecking ? 'Checking…' : 'Check now' }}</button>
          </section>
        </template>

        <template v-else>
          <div class="card-heading"><div><span class="card-label">1. RECIPIENT</span><h2>Transfer gold coins</h2></div><span class="step-count">Backend validated</span></div>
          <form class="merchant-transfer-form" @submit.prevent="submitTransfer">
            <label>User ID<input v-model="targetUserId" autocomplete="off" placeholder="Enter recipient user ID" /></label>
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
      </div>
    </section>
  </main>
</template>
