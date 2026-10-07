import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import MerchantLoginView from './views/MerchantLoginView.vue'
import MerchantProfileView from './views/MerchantProfileView.vue'
import MerchantRechargeView from './views/MerchantRechargeView.vue'
import { readMerchantSession } from './api/merchantAuth'
import './styles.css'

const router = createRouter({
  history: createWebHashHistory('/'),
  routes: [
    // CoinDealer is a merchant portal. Keep the login page at the root so a
    // freshly deployed subdomain never falls into the old end-user checkout.
    { path: '/', component: MerchantLoginView },
    { path: '/merchant/login', component: MerchantLoginView },
    { path: '/merchant', redirect: '/merchant/recharge' },
    { path: '/merchant/profile', component: MerchantProfileView, meta: { requiresMerchant: true } },
    { path: '/merchant/recharge', component: MerchantRechargeView, meta: { requiresMerchant: true } },
    // Hash routing keeps application paths in the browser. Unknown client
    // routes should still land on the canonical login page.
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

const defaultMerchantRoute = '/merchant/recharge'

function protectedMerchantRedirect(value: unknown) {
  if (typeof value !== 'string') return defaultMerchantRoute
  const resolved = router.resolve(value)
  return resolved.matched.some((record) => record.meta.requiresMerchant)
    ? resolved.fullPath
    : defaultMerchantRoute
}

router.beforeEach((to) => {
  const session = readMerchantSession()
  const isLoginRoute = to.path === '/' || to.path === '/merchant/login'
  if (to.meta.requiresMerchant && !session) {
    return { path: '/', query: { redirect: to.fullPath }, replace: true }
  }
  if (isLoginRoute && session) {
    const redirect = protectedMerchantRedirect(to.query.redirect)
    const resolvedRedirect = router.resolve(redirect)
    if (resolvedRedirect.path === '/merchant/profile') {
      return { path: resolvedRedirect.path, query: resolvedRedirect.query, hash: resolvedRedirect.hash, replace: true }
    }
    return { path: '/merchant/profile', query: { next: redirect }, replace: true }
  }
  return true
})

router.onError((error, to) => {
  console.error('Router navigation failed.', error)
  if (to.path !== '/') window.location.replace('/')
})

createApp(App).use(router).mount('#app')
