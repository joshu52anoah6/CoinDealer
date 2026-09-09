<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError } from '../api/http'
import { rechargeApi } from '../api/recharge'

const route = useRoute()
const orderId = computed(() => String(route.query.orderId || route.query.order_id || ''))
const loading = ref(true)
const checking = ref(false)
const success = ref(false)
const gold = ref<number | null>(null)
const balance = ref<number | null>(null)
const errorMessage = ref('')
let timer: number | undefined

async function checkOrder() {
  if (!orderId.value || checking.value) return
  checking.value = true
  try {
    const response = await rechargeApi.checkOrder(orderId.value)
    success.value = Boolean(response.success)
    gold.value = typeof response.gold === 'number' ? response.gold : null
    balance.value = typeof response.goldBalance === 'number' ? response.goldBalance : null
    if (success.value && timer) window.clearInterval(timer)
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : 'Unable to check order status.'
  } finally {
    loading.value = false
    checking.value = false
  }
}

onMounted(() => {
  if (!orderId.value) {
    loading.value = false
    errorMessage.value = 'Missing order reference.'
    return
  }
  checkOrder()
  timer = window.setInterval(checkOrder, 3000)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <main class="page-shell result-shell">
    <header class="topbar"><div class="brand-mark"><span class="brand-dot" /> Recharge <small>PAY</small></div><div class="secure-label"><span class="lock-icon">⌁</span> Secure checkout</div></header>
    <section class="result-card">
      <div v-if="loading" class="result-icon pending">…</div>
      <div v-else-if="success" class="result-icon success">✓</div>
      <div v-else class="result-icon pending">⋯</div>
      <p class="eyebrow">PAYMENT STATUS</p>
      <h1>{{ success ? 'Recharge complete' : 'Payment is being confirmed' }}</h1>
      <p v-if="success">Your coins have been added to your account.</p>
      <p v-else-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
      <p v-else>Keep this page open. We are waiting for the payment provider to confirm your order.</p>
      <div v-if="success" class="result-details"><span>Added coins<strong>{{ gold?.toLocaleString() ?? '—' }}</strong></span><span>New balance<strong>{{ balance?.toLocaleString() ?? '—' }}</strong></span></div>
      <p class="order-reference">Order {{ orderId || '—' }}</p>
      <button class="secondary-button" @click="checkOrder">{{ checking ? 'Checking…' : 'Refresh status' }}</button>
    </section>
  </main>
</template>
