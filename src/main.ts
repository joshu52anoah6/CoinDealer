import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import CheckoutView from './views/CheckoutView.vue'
import ResultView from './views/ResultView.vue'
import MerchantLoginView from './views/MerchantLoginView.vue'
import MerchantRechargeView from './views/MerchantRechargeView.vue'
import { readMerchantSession } from './api/merchantAuth'
import './styles.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // The root URL is the canonical entry point so App/H5 can open the site
    // without exposing an implementation-specific page suffix.
    { path: '/', component: CheckoutView },
    { path: '/payment-result', component: ResultView },
    { path: '/merchant/login', component: MerchantLoginView },
    { path: '/merchant', redirect: '/merchant/recharge' },
    { path: '/merchant/recharge', component: MerchantRechargeView, meta: { requiresMerchant: true } },
  ],
})

router.beforeEach((to) => {
  if (to.meta.requiresMerchant && !readMerchantSession()) {
    return { path: '/merchant/login', query: { redirect: to.fullPath } }
  }
  if (to.path === '/merchant/login' && readMerchantSession()) return '/merchant/recharge'
  return true
})

createApp(App).use(router).mount('#app')
