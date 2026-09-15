<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/http'
import { merchantLogin, saveMerchantSession } from '../api/merchantAuth'

const router = useRouter()
const route = useRoute()
const account = ref('')
const password = ref('')
const submitting = ref(false)
const errorMessage = ref('')

async function submit() {
  if (submitting.value) return
  const normalizedAccount = account.value.trim()
  if (!normalizedAccount || !password.value) {
    errorMessage.value = 'Enter your merchant account and password.'
    return
  }
  if (normalizedAccount.length < 2 || normalizedAccount.length > 32) {
    errorMessage.value = 'Username must be between 2 and 32 characters.'
    return
  }
  if (password.value.length < 6 || password.value.length > 32) {
    errorMessage.value = 'Password must be between 6 and 32 characters.'
    return
  }
  submitting.value = true
  errorMessage.value = ''
  try {
    const session = await merchantLogin(normalizedAccount, password.value)
    if (!session) {
      throw new Error('This account is not a merchant account, or the login API returned no valid token.')
    }
    saveMerchantSession(session)
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/merchant')
      ? route.query.redirect
      : '/merchant/recharge'
    await router.replace({ path: '/merchant/profile', query: { next: redirect } })
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : (error as Error).message || 'Login failed. Please try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="page-shell merchant-login-shell">
    <section class="merchant-login-card">
      <div class="merchant-logo"><span class="brand-dot" /> Coin merchant <small>PORTAL</small></div>
      <p class="eyebrow">COIN MERCHANT PORTAL</p>
      <h1>Merchant sign in</h1>
      <p class="merchant-login-copy">Sign in to recharge the merchant wallet and transfer gold coins to users.</p>

      <form class="merchant-form" @submit.prevent="submit">
        <label>Username<input v-model="account" autocomplete="username" placeholder="Enter coin-merchant username" /></label>
        <label>Password<input v-model="password" type="password" autocomplete="current-password" placeholder="Enter password" /></label>
        <p v-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
        <button class="primary-button" type="submit" :disabled="submitting">
          <span v-if="submitting" class="spinner" />{{ submitting ? 'Signing in…' : 'Open merchant portal' }}<span v-if="!submitting">→</span>
        </button>
      </form>
      <p class="terms">Only accounts with merchant permissions can use this portal.</p>
    </section>
  </main>
</template>
