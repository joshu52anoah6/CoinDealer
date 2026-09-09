<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/http'
import { merchantApi } from '../api/merchant'
import { clearMerchantSession, readMerchantSession, type MerchantSession } from '../api/merchantAuth'
import { watchMerchantOrder, type MerchantOrderState, type MerchantOrderUpdate } from '../api/merchantSocket'
import { normalizeConfigs, normalizeCurrencies, rechargeApi } from '../api/recharge'
import type { FiatCurrency, RechargeConfig } from '../types/api'
import { currencySymbols, formatMoney } from '../utils/locale'

const router = useRouter()
const route = useRoute()
const session = ref<MerchantSession | null>(null)
const targetUserId = ref(typeof route.query.userId === 'string' ? route.query.userId.trim() : '')
const configs = ref<RechargeConfig[]>([])
const currencies = ref<FiatCurrency[]>([])
const selectedCurrency = ref('')
const selectedPlanId = ref<string | number>('')
const loading = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const optionsLoaded = ref(false)
const orderId = ref('')
const orderState = ref<MerchantOrderState | ''>('')
const orderUpdate = ref<MerchantOrderUpdate | null>(null)
const socketState = ref<'idle' | 'connecting' | 'connected' | 'closed' | 'error'>('idle')
let stopSocket: (() => void) | null = null

const availableCurrencies = computed(() => {
  const values = [...new Set(currencies.value
    .map((item) => String(item.currencyCode || '').trim().toUpperCase())
    .filter(Boolean))]
  return values.length ? values : ['IDR']
})
const selectedPlan = computed(() => configs.value.find((item) => String(item.id) === String(selectedPlanId.value)))
const merchantName = computed(() => session.value?.username || session.value?.merchantId || 'Merchant')

function currencySymbol(currency: string) {
  const metadata = currencies.value.find((item) => String(item.currencyCode || '').toUpperCase() === currency.toUpperCase())
  return metadata?.symbol || currencySymbols[currency] || currency.slice(0, 1)
}

function planCoins(plan: RechargeConfig) {
  const value = plan.actualCreditedGold ?? plan.creditedGold ?? plan.actualCreditedCoins ?? plan.creditedCoins ?? plan.gold ?? plan.coins
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString() : '—'
}

async function loadOptions() {
  if (!session.value) return
  const userId = targetUserId.value.trim()
  if (!userId) {
    errorMessage.value = 'Enter a target user ID first.'
    return
  }
  loading.value = true
  optionsLoaded.value = false
  errorMessage.value = ''
  try {
    const [configResult, currencyResult] = await Promise.allSettled([
      merchantApi.getConfigs(userId, session.value.token),
      rechargeApi.getCurrencies(),
    ])
    if (configResult.status === 'rejected') throw configResult.reason
    configs.value = normalizeConfigs(configResult.value)
    currencies.value = currencyResult.status === 'fulfilled' ? normalizeCurrencies(currencyResult.value) : []
    selectedCurrency.value = availableCurrencies.value[0] || ''
    selectedPlanId.value = configs.value[0]?.id ?? ''
    optionsLoaded.value = true
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : (error as Error).message || 'Unable to load recharge packages.'
  } finally {
    loading.value = false
  }
}

function closeSocket() {
  stopSocket?.()
  stopSocket = null
  if (socketState.value !== 'connected') socketState.value = 'idle'
}

function connectSocket() {
  if (!session.value || !orderId.value) return
  closeSocket()
  try {
    stopSocket = watchMerchantOrder(session.value.token, orderId.value, {
      onUpdate(update) {
        orderUpdate.value = update
        orderState.value = update.state
        if (update.state !== 'pending') closeSocket()
      },
      onState(state) {
        socketState.value = state
      },
    })
  } catch {
    socketState.value = 'error'
  }
}

async function submitRecharge() {
  if (!session.value || !selectedPlan.value || submitting.value) return
  const userId = targetUserId.value.trim()
  const cfgId = Number(selectedPlan.value.id)
  if (!userId) {
    errorMessage.value = 'Enter a target user ID.'
    return
  }
  if (!Number.isSafeInteger(cfgId) || cfgId < 0) {
    errorMessage.value = 'The selected recharge package has an invalid ID.'
    return
  }
  submitting.value = true
  errorMessage.value = ''
  closeSocket()
  orderId.value = ''
  orderState.value = ''
  orderUpdate.value = null
  try {
    const result = await merchantApi.createRecharge({ userId, cfgId, currencyCode: selectedCurrency.value }, session.value.token)
    const raw = result as Record<string, unknown>
    const createdOrderId = raw.orderId ?? raw.order_id ?? raw.tradeNo
    if (createdOrderId === undefined || createdOrderId === null || String(createdOrderId).trim() === '') {
      throw new Error('The recharge API did not return an order ID.')
    }
    orderId.value = String(createdOrderId)
    orderState.value = 'pending'
    connectSocket()
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : (error as Error).message || 'Unable to create the recharge order.'
  } finally {
    submitting.value = false
  }
}

function logout() {
  closeSocket()
  clearMerchantSession()
  session.value = null
  router.replace('/merchant/login')
}

onMounted(() => {
  session.value = readMerchantSession()
  if (!session.value) {
    router.replace({ path: '/merchant/login', query: { redirect: '/merchant/recharge' } })
    return
  }
  if (targetUserId.value) loadOptions()
})

onUnmounted(closeSocket)
</script>

<template>
  <main class="page-shell merchant-shell">
    <header class="topbar merchant-topbar">
      <div class="brand-mark"><span class="brand-dot" /> Recharge <small>MERCHANT</small></div>
      <div class="merchant-account"><span>{{ merchantName }}</span><button class="logout-button" @click="logout">Sign out</button></div>
    </header>

    <section class="merchant-layout">
      <div class="merchant-intro">
        <p class="eyebrow">COIN MERCHANT PORTAL</p>
        <h1>Recharge a user</h1>
        <p class="subtitle">Enter a user ID and choose a configured package. The WebSocket reports the order result in real time.</p>
        <div class="merchant-notice"><span>↯</span><div><strong>Live order status</strong><p>A secure stream starts after the order is created, so no manual refresh is needed.</p></div></div>
      </div>

      <div class="merchant-card">
        <div class="card-heading"><div><span class="card-label">1. TARGET</span><h2>Recharge target</h2></div><span class="step-count">Merchant action</span></div>
        <form class="merchant-target-form" @submit.prevent="loadOptions">
          <label>User ID<input v-model="targetUserId" autocomplete="off" placeholder="Enter user ID" /></label>
          <button class="secondary-button" type="submit" :disabled="loading">{{ loading ? 'Loading…' : 'Load packages' }}</button>
        </form>

        <template v-if="optionsLoaded">
          <div class="card-heading merchant-section-heading"><div><span class="card-label">2. ORDER</span><h2>Recharge details</h2></div><span class="step-count">{{ configs.length }} packages</span></div>
          <div class="currency-list">
            <button v-for="currency in availableCurrencies" :key="currency" class="currency-pill" :class="{ selected: selectedCurrency === currency }" @click="selectedCurrency = currency">
              <span class="currency-symbol">{{ currencySymbol(currency) }}</span>{{ currency }}<span v-if="selectedCurrency === currency" class="check">✓</span>
            </button>
          </div>
          <div class="plans-grid merchant-plans-grid">
            <button v-for="plan in configs" :key="plan.id" class="plan-card" :class="{ selected: String(selectedPlanId) === String(plan.id) }" @click="selectedPlanId = plan.id">
              <span class="plan-name">{{ plan.name || plan.packageName || `Package ${plan.id}` }}</span>
              <strong class="plan-price">{{ formatMoney(Number(plan.price || 0), plan.currency || selectedCurrency) }}</strong>
              <span class="plan-gold">{{ planCoins(plan) }} coins</span>
              <span v-if="String(selectedPlanId) === String(plan.id)" class="plan-check">✓</span>
            </button>
          </div>
          <div v-if="selectedPlan" class="order-summary">
            <div><span>Target user</span><strong>{{ targetUserId }}</strong></div>
            <div><span>Amount</span><strong>{{ formatMoney(Number(selectedPlan.price || 0), selectedPlan.currency || selectedCurrency) }}</strong></div>
            <div><span>Credits</span><strong>{{ planCoins(selectedPlan) }} coins</strong></div>
          </div>
          <button class="primary-button" :disabled="submitting || !selectedPlan" @click="submitRecharge">
            <span v-if="submitting" class="spinner" />{{ submitting ? 'Creating order…' : 'Confirm recharge' }}<span v-if="!submitting">→</span>
          </button>
        </template>

        <p v-if="errorMessage" class="inline-error merchant-error">{{ errorMessage }}</p>

        <section v-if="orderId" class="merchant-order-status" :class="`status-${orderState}`">
          <div class="status-heading"><span class="status-dot" /><strong>{{ orderState === 'success' ? 'Recharge successful' : orderState === 'failed' ? 'Recharge failed' : 'Waiting for result' }}</strong><span class="socket-label">{{ socketState === 'connected' ? 'Live connection active' : socketState === 'connecting' ? 'Connecting…' : socketState === 'error' ? 'Connection failed' : 'Connection closed' }}</span></div>
          <p>Order: {{ orderId }}</p>
          <p v-if="orderUpdate?.message">{{ orderUpdate.message }}</p>
          <button v-if="orderState === 'pending' && socketState !== 'connected'" class="secondary-button" @click="connectSocket">Reconnect</button>
        </section>
      </div>
    </section>
  </main>
</template>
