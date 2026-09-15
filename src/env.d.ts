/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_BUILD_OUT_DIR?: string
  readonly VITE_MERCHANT_SITE_URL?: string
  readonly VITE_MERCHANT_LOGIN_PATH?: string
  readonly VITE_MERCHANT_CONFIG_PATH?: string
  readonly VITE_MERCHANT_RECHARGE_PATH?: string
  readonly VITE_MERCHANT_ORDER_STATUS_PATH?: string
  readonly VITE_MERCHANT_TRANSFER_PATH?: string
  readonly VITE_MERCHANT_BALANCE_PATH?: string
  readonly VITE_MERCHANT_PROFILE_GET_PATH?: string
  readonly VITE_MERCHANT_PROFILE_SAVE_PATH?: string
  readonly VITE_MERCHANT_API_ENCRYPTION?: string
  readonly VITE_MERCHANT_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
