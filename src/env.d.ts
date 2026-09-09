/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_BUILD_OUT_DIR?: string
  readonly VITE_MERCHANT_LOGIN_PATH?: string
  readonly VITE_MERCHANT_CONFIG_PATH?: string
  readonly VITE_MERCHANT_RECHARGE_PATH?: string
  readonly VITE_MERCHANT_WS_URL?: string
  readonly VITE_MERCHANT_WS_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
