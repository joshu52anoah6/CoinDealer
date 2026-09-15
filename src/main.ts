import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import MerchantLoginView from './views/MerchantLoginView.vue'
import MerchantProfileView from './views/MerchantProfileView.vue'
import MerchantRechargeView from './views/MerchantRechargeView.vue'
import { readMerchantSession } from './api/merchantAuth'
import './styles.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // CoinDealer is a merchant portal. Keep the login page at the root so a
    // freshly deployed subdomain never falls into the old end-user checkout.
    { path: '/', component: MerchantLoginView },
    { path: '/merchant/login', component: MerchantLoginView },
    { path: '/merchant', redirect: '/merchant/recharge' },
    { path: '/merchant/profile', component: MerchantProfileView, meta: { requiresMerchant: true } },
    { path: '/merchant/recharge', component: MerchantRechargeView, meta: { requiresMerchant: true } },
    // A history-mode fallback must still be configured on the web server, but
    // once index.html is served, unknown client paths should land on login.
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const isLoginRoute = to.path === '/' || to.path === '/merchant/login'
  if (to.meta.requiresMerchant && !readMerchantSession()) {
    return { path: '/', query: { redirect: to.fullPath } }
  }
  if (isLoginRoute && readMerchantSession()) {
    return { path: '/merchant/profile', query: { next: '/merchant/recharge' } }
  }
  return true
})

createApp(App).use(router).mount('#app')
