<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/http'
import { getProviderUrl, normalizeConfigs, normalizeCurrencies, rechargeApi } from '../api/recharge'
import type { FiatCurrency, RechargeConfig } from '../types/api'
import { formatMoney, currencySymbols } from '../utils/locale'
import {
  findRecommendedPlan,
  getPlanCreditedAmount,
  parseRechargeRecommendationQuery,
  type RechargeRecommendationQuery,
} from '../utils/rechargeRecommendation'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const submitting = ref(false)
const errorMessage = ref('')
const isEmbedded = ref(false)
const userId = ref('')
const configs = ref<RechargeConfig[]>([])
const currencyCatalog = ref<FiatCurrency[]>([])
const selectedCurrency = ref('')
const selectedPlanId = ref<string | number>('')
const recommendationQuery = ref<RechargeRecommendationQuery | null>(null)
const recommendedPlanId = ref<string | number>('')
const recommendationNoCoverage = ref(false)
const fallbackChannelCurrencyCode = 'IDR'
let paymentWindow: Window | null = null

const appName = computed(() => route.query.app === 'vueh5' ? 'VueH5' : route.query.app === 'sora' ? 'Sora' : 'Recharge')
const showFirstRecharge = computed(() => configs.value.some((item) => item.firstRecharge || item.isFirstRecharge || item.isFirst))
const currencies = computed(() => {
  const seen = new Set<string>()
  const catalogCurrencies = currencyCatalog.value
    .map((item) => String(item.currencyCode || '').trim())
    .filter((currency) => {
      const key = currency.toUpperCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  // Keep checkout usable if the optional metadata call is unavailable. The
  // channel endpoint currently documents IDR as its fallback currency.
  return catalogCurrencies.length ? catalogCurrencies : [fallbackChannelCurrencyCode]
})
const plans = computed(() => {
  // RechargeConfig.currency is the price/base currency (the API currently
  // returns USD), not the selected channel payment currency. Do not filter
  // these tiers by it; currencyCode is supplied when creating the order.
  const current = configs.value
  const markedFirst = current.filter((item) => item.firstRecharge || item.isFirstRecharge || item.isFirst)
  // When the user-scoped response marks first-recharge tiers, only those tiers
  // receive the activity treatment.
  return showFirstRecharge.value && markedFirst.length ? markedFirst : current
})
const selectedPlan = computed(() => plans.value.find((item) => String(item.id) === String(selectedPlanId.value)))

function bonusGold(plan: RechargeConfig) {
  // Only display a bonus when the backend explicitly supplies one. In
  // particular, do not derive a bonus from firstRechargeRatio in the browser.
  // A credited/actual gold field is already the backend's final amount, so a
  // separate bonus label would be misleading and could suggest double credit.
  const hasFinalGoldAmount = [plan.actualCreditedGold, plan.creditedGold, plan.actualCreditedCoins, plan.creditedCoins]
    .some((value) => value !== undefined && value !== null && value !== '')
  if (hasFinalGoldAmount) return 0
  const value = plan.bonusGold ?? plan.extraGold
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

function planTotalGold(plan: RechargeConfig) {
  const credited = getPlanCreditedAmount(plan, 'gold')
  if (credited !== null) return credited.toLocaleString()
  return '—'
}

const totalGold = computed(() => selectedPlan.value ? planTotalGold(selectedPlan.value) : '—')

function creditedAmountForRecommendation(plan: RechargeConfig) {
  const currency = recommendationQuery.value?.rechargeCurrency
  return currency ? getPlanCreditedAmount(plan, currency) : null
}

function isRecommendedPlan(plan: RechargeConfig) {
  return recommendationQuery.value !== null
    && String(recommendedPlanId.value) === String(plan.id)
}

function creditedAmountLabel(plan: RechargeConfig) {
  const amount = creditedAmountForRecommendation(plan)
  if (amount === null || !recommendationQuery.value) return ''
  return `${amount.toLocaleString()} ${recommendationQuery.value.rechargeCurrency}`
}

function applyPlanRecommendation() {
  recommendedPlanId.value = ''
  recommendationNoCoverage.value = false
  const recommendation = findRecommendedPlan(plans.value, recommendationQuery.value)
  if (recommendation) {
    recommendedPlanId.value = recommendation.plan.id
    selectedPlanId.value = recommendation.plan.id
  } else if (recommendationQuery.value) {
    recommendationNoCoverage.value = true
  }
}

function currencySymbol(currency: string) {
  const metadata = currencyCatalog.value.find((item) => String(item.currencyCode || '').toUpperCase() === currency.toUpperCase())
  return metadata?.symbol || currencySymbols[currency] || currency.slice(0, 1)
}

function firstQueryValue(value: unknown) {
  if (Array.isArray(value)) return value[0]
  return value
}

function resolveUserId() {
  // userId is the public contract. The aliases are accepted for compatibility
  // with existing App/H5 deep-link builders.
  const candidates = [
    route.query.userId,
    route.query.user_id,
    route.query.uid,
    route.query.id,
  ]
  return candidates
    .map((value) => String(firstQueryValue(value) ?? '').trim())
    .find((value) => value && value !== 'undefined' && value !== 'null') || ''
}

function setCurrency(currency: string) {
  selectedCurrency.value = currency
  const stillAvailable = plans.value.some((item) => String(item.id) === String(selectedPlanId.value))
  if (!stillAvailable) selectedPlanId.value = plans.value[0]?.id ?? ''
}

function pickPlan(plan: RechargeConfig) {
  selectedPlanId.value = plan.id
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  recommendationQuery.value = parseRechargeRecommendationQuery(route.query as Record<string, unknown>)
  recommendedPlanId.value = ''
  recommendationNoCoverage.value = false
  try {
    userId.value = resolveUserId()
    if (!userId.value) {
      throw new Error('Missing user ID. Open this page from Sora or VueH5 with userId.')
    }
    const [configResult, currencyResult] = await Promise.allSettled([
      rechargeApi.getConfigs(userId.value),
      rechargeApi.getCurrencies(),
    ])
    if (configResult.status === 'rejected') throw configResult.reason
    configs.value = normalizeConfigs(configResult.value)
    currencyCatalog.value = currencyResult.status === 'fulfilled' ? normalizeCurrencies(currencyResult.value) : []
    const queryCurrency = String(route.query.currency || '')
    selectedCurrency.value = currencies.value.find((currency) => currency.toUpperCase() === queryCurrency.toUpperCase()) || currencies.value[0] || ''
    selectedPlanId.value = plans.value[0]?.id ?? ''
    applyPlanRecommendation()
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : (error as Error).message || 'Unable to load recharge options.'
  } finally {
    loading.value = false
  }
}

function activityTitle() {
  return 'Welcome offer'
}

function activityButtonText() {
  return 'Recharge now'
}

function detectEmbeddedContext() {
  try {
    return window.self !== window.top
  } catch {
    // A sandboxed/cross-origin frame should be treated as embedded by default.
    return true
  }
}

function openPaymentWindow() {
  // Open synchronously from the click handler. Opening only after the order
  // request resolves is commonly blocked by popup blockers.
  // Do not pass the noopener feature here: some browsers return an unusable
  // WindowProxy for that form, leaving an uncontrollable about:blank tab. The
  // reference is needed to replace the placeholder once the API responds.
  const popup = window.open('about:blank', '_blank')
  if (popup) {
    try {
      popup.opener = null
      popup.document.title = 'Secure payment'
      popup.document.body.textContent = 'Preparing secure payment…'
      popup.document.body.style.cssText = 'margin:0;display:grid;place-items:center;min-height:100vh;background:#07111f;color:#c9d7e8;font:16px system-ui,sans-serif;'
    } catch {
      // The popup may already be navigating or may be subject to a browser
      // security policy. Navigation below still has a safe fallback.
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
      // A browser extension or popup policy can invalidate the reference.
      // Continue with a top-level navigation rather than leaving a blank tab.
      paymentWindow = null
    }
  }

  // If a popup was blocked while this page is embedded, navigate the top-level
  // browsing context instead of loading a payment provider inside the frame.
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.assign(url)
      return
    }
  } catch {
    // Fall back to the current context when a host sandbox prevents top-level
    // navigation. The provider can still enforce its own frame-ancestors rule.
  }
  window.location.assign(url)
}

async function submitPayment() {
  if (!selectedPlan.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  paymentWindow = null
  try {
    const cfgId = Number(selectedPlan.value.id)
    if (!Number.isSafeInteger(cfgId) || cfgId < 0) {
      throw new Error('The selected recharge package has an invalid configuration ID.')
    }

    paymentWindow = openPaymentWindow()
    // Only the selected backend configuration, channel currency and supplied
    // user ID are sent to the existing order endpoint. Recommendation query
    // values are presentation hints and never become the order amount.
    const result = await rechargeApi.createOrder({
      cfgId,
      currencyCode: selectedCurrency.value || fallbackChannelCurrencyCode,
      userId: userId.value,
    })
    const orderId = result.orderId
    const providerUrl = getProviderUrl(result)
    if (!orderId) throw new Error('The payment order was not created.')
    if (!providerUrl) {
      closePaymentWindow()
      const hasProviderValue = [result.checkoutUrl, result.paymentUrl, result.payUrl, result.redirectUrl, result.url]
        .some((value) => typeof value === 'string' && value.trim())
      if (hasProviderValue) {
        throw new Error('The payment provider returned an invalid or insecure payment URL.')
      }
      // Keep the result route usable if the provider URL is temporarily absent.
      await router.push({ path: '/payment-result', query: { orderId, pending: '1' } })
      return
    }
    navigateToProvider(providerUrl)
  } catch (error) {
    closePaymentWindow()
    errorMessage.value = error instanceof ApiError ? error.message : (error as Error).message || 'Unable to start payment.'
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  isEmbedded.value = detectEmbeddedContext()
  load()
})

onUnmounted(closePaymentWindow)
</script>

<template>
  <main class="page-shell" :class="{ 'is-embedded': isEmbedded }">
    <header class="topbar">
      <div class="brand-mark"><span class="brand-dot" /> {{ appName }} <small>PAY</small></div>
      <div class="secure-label"><span class="lock-icon">⌁</span> Secure checkout</div>
    </header>

    <section class="checkout-layout">
      <div class="intro-column">
        <p class="eyebrow">ACCOUNT RECHARGE</p>
        <h1>Choose your recharge</h1>
        <p class="subtitle">Select a currency and package. A secure payment window will open with our payment partner.</p>

        <div v-if="showFirstRecharge" class="first-recharge-banner">
          <div class="banner-orb">✦</div>
          <div class="banner-copy">
            <span class="banner-kicker">FIRST RECHARGE</span>
            <strong>{{ activityTitle() }}</strong>
            <span>Exclusive rewards are available on your first purchase.</span>
          </div>
        </div>
      </div>

      <div class="payment-card">
        <div v-if="loading" class="loading-state">
          <div class="skeleton skeleton-title" /><div class="skeleton" /><div class="skeleton" /><div class="skeleton wide" />
        </div>
        <div v-else-if="errorMessage" class="state-message error-state">
          <div class="state-icon">!</div><h2>Unable to load</h2><p>{{ errorMessage }}</p><button class="secondary-button" @click="load">Try again</button>
        </div>
        <div v-else-if="!currencies.length || !plans.length" class="state-message">
          <div class="state-icon">—</div><h2>No packages available</h2><p>Please try again later.</p>
        </div>
        <template v-else>
          <div class="card-heading"><div><span class="card-label">1. CURRENCY</span><h2>Payment currency</h2></div><span class="step-count">1 / 2</span></div>
          <div class="currency-list">
            <button v-for="currency in currencies" :key="currency" class="currency-pill" :class="{ selected: selectedCurrency === currency }" @click="setCurrency(currency)">
              <span class="currency-symbol">{{ currencySymbol(currency) }}</span>{{ currency }}<span v-if="selectedCurrency === currency" class="check">✓</span>
            </button>
          </div>

          <div class="card-heading plan-heading"><div><span class="card-label">2. PACKAGE</span><h2>Choose an amount</h2></div><span class="step-count">2 / 2</span></div>
          <div class="plans-grid">
            <button v-for="plan in plans" :key="plan.id" class="plan-card" :class="{ selected: String(selectedPlanId) === String(plan.id), 'is-recommended': isRecommendedPlan(plan) }" @click="pickPlan(plan)">
              <span v-if="showFirstRecharge" class="plan-ribbon">FIRST</span>
              <span class="plan-name">{{ plan.name || plan.packageName || `${plan.gold || 0} credits` }}</span>
              <strong class="plan-price">{{ formatMoney(Number(plan.price || 0), plan.currency || selectedCurrency) }}</strong>
              <span class="plan-gold">{{ planTotalGold(plan) }} coins</span>
              <span v-if="bonusGold(plan)" class="bonus">+{{ bonusGold(plan) }} bonus</span>
              <span v-if="isRecommendedPlan(plan)" class="plan-recommendation"><strong>Recommended</strong><span>Covers required amount</span></span>
              <span v-if="creditedAmountLabel(plan)" class="plan-credited">{{ creditedAmountLabel(plan) }}</span>
              <span v-if="String(selectedPlanId) === String(plan.id)" class="plan-check">✓</span>
            </button>
          </div>

          <p v-if="recommendationNoCoverage" class="recommendation-notice">No package covers the required amount. Please choose a larger package.</p>

          <div v-if="selectedPlan" class="order-summary">
            <div><span>Total</span><strong>{{ formatMoney(Number(selectedPlan.price || 0), selectedPlan.currency || selectedCurrency) }}</strong></div>
            <div><span>Credits</span><strong>{{ totalGold.toLocaleString() }}</strong></div>
          </div>
          <p v-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
          <button class="primary-button" :disabled="submitting || !selectedPlan" @click="submitPayment">
            <span v-if="submitting" class="spinner" />{{ submitting ? 'Preparing secure payment…' : (showFirstRecharge ? activityButtonText() : 'Continue to payment') }}<span v-if="!submitting">→</span>
          </button>
          <p class="terms">By continuing, you agree to the applicable terms and payment partner policies.</p>
        </template>
      </div>
    </section>
    <footer class="footer">Payments are processed securely by our authorized payment provider.</footer>
  </main>
</template>
