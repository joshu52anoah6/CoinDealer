<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/http'
import { merchantApi } from '../api/merchant'
import { isMerchantPayProfileEmpty, normalizeMerchantPayProfile } from '../api/merchantProfile'
import { clearMerchantSession, readMerchantSession } from '../api/merchantAuth'

const route = useRoute()
const router = useRouter()
const form = reactive({ name: '', email: '', phone: '' })
const loading = ref(true)
const profileReady = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const editMode = computed(() => route.query.mode === 'edit')

function nextRoute() {
  const value = typeof route.query.next === 'string' ? route.query.next : ''
  return value.startsWith('/merchant/') && !value.startsWith('/merchant/profile')
    ? value
    : '/merchant/recharge'
}

function isTokenError(error: unknown) {
  if (!(error instanceof ApiError)) return false
  if (error.status === 401) return true
  if (!error.payload || typeof error.payload !== 'object') return false
  const code = (error.payload as Record<string, unknown>).code
  return code === 3 || code === '3'
}

function handleError(error: unknown, fallback: string) {
  if (isTokenError(error)) {
    clearMerchantSession()
    void router.replace({ path: '/', query: { redirect: nextRoute() } })
    return 'Merchant session expired. Please sign in again.'
  }
  return error instanceof ApiError ? error.message : (error as Error)?.message || fallback
}

async function loadProfile() {
  const session = readMerchantSession()
  if (!session) {
    await router.replace({ path: '/', query: { redirect: nextRoute() } })
    return
  }
  loading.value = true
  profileReady.value = false
  errorMessage.value = ''
  try {
    const result = await merchantApi.getPayProfile(session.token)
    const profile = normalizeMerchantPayProfile(result)
    Object.assign(form, profile)
    profileReady.value = true
    if (!editMode.value && !isMerchantPayProfileEmpty(profile)) {
      await router.replace(nextRoute())
    }
  } catch (error) {
    errorMessage.value = handleError(error, 'Unable to load payer profile. Please try again.')
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (submitting.value) return
  const profile = normalizeMerchantPayProfile(form)
  if (!profile.name) {
    errorMessage.value = 'Enter the payer name.'
    return
  }
  if (!profile.email) {
    errorMessage.value = 'Enter the payer email.'
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
    errorMessage.value = 'Enter a valid email address.'
    return
  }
  const session = readMerchantSession()
  if (!session) {
    await router.replace({ path: '/', query: { redirect: nextRoute() } })
    return
  }
  submitting.value = true
  errorMessage.value = ''
  try {
    const input = profile.phone
      ? profile
      : { name: profile.name, email: profile.email }
    const result = await merchantApi.savePayProfile(input, session.token)
    if (result?.success === false) throw new Error('The payer profile was not saved. Please try again.')
    await router.replace(nextRoute())
  } catch (error) {
    errorMessage.value = handleError(error, 'Unable to save payer profile. Please try again.')
  } finally {
    submitting.value = false
  }
}

function cancelEdit() {
  void router.replace(nextRoute())
}

function logout() {
  clearMerchantSession()
  void router.replace('/')
}

onMounted(() => {
  void loadProfile()
})
</script>

<template>
  <main class="page-shell merchant-profile-shell">
    <section class="merchant-login-card merchant-profile-card">
      <div class="merchant-logo"><span class="brand-dot" /> Coin merchant <small>PORTAL</small></div>
      <div class="merchant-profile-steps" aria-label="Merchant setup progress">
        <span class="complete">1. Sign in</span><i />
        <span class="current">2. Payer profile</span><i />
        <span>3. Wallet</span>
      </div>

      <p class="eyebrow">{{ editMode ? 'ACCOUNT DETAILS' : 'ONE-TIME SETUP' }}</p>
      <h1>{{ editMode ? 'Edit payer profile' : 'Complete your profile' }}</h1>
      <p class="merchant-login-copy">
        {{ editMode
          ? 'Keep the payer details used by the payment channel up to date.'
          : 'Add the payer details required by the payment channel before your first recharge.' }}
      </p>

      <div v-if="loading" class="loading-state merchant-profile-loading">
        <div class="skeleton" /><div class="skeleton" /><div class="skeleton" />
        <p>Checking saved profile…</p>
      </div>

      <div v-else-if="!profileReady" class="merchant-profile-retry">
        <p class="inline-error">{{ errorMessage }}</p>
        <button class="secondary-button" type="button" @click="loadProfile">Try again</button>
        <button class="secondary-button merchant-profile-cancel" type="button" @click="editMode ? cancelEdit() : logout()">{{ editMode ? 'Back to wallet' : 'Sign out' }}</button>
      </div>

      <form v-else class="merchant-form" @submit.prevent="submit">
        <label>Payer name<input v-model="form.name" autocomplete="name" placeholder="Enter full name" /></label>
        <label>Email<input v-model="form.email" type="email" autocomplete="email" placeholder="name@example.com" /></label>
        <label>Phone <span class="optional-label">Optional</span><input v-model="form.phone" type="tel" autocomplete="tel" placeholder="Enter phone number" /></label>
        <p v-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
        <button class="primary-button" type="submit" :disabled="submitting">
          <span v-if="submitting" class="spinner" />{{ submitting ? 'Saving…' : editMode ? 'Save changes' : 'Save and continue' }}<span v-if="!submitting">→</span>
        </button>
        <button v-if="editMode" class="secondary-button merchant-profile-cancel" type="button" :disabled="submitting" @click="cancelEdit">Cancel</button>
        <button v-else class="merchant-profile-signout" type="button" :disabled="submitting" @click="logout">Sign out</button>
      </form>
    </section>
  </main>
</template>
