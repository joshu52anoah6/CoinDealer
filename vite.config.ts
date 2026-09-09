import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [vue()],
    server: {
      host: '0.0.0.0',
      port: Number(env.VITE_DEV_PORT || 5173),
    },
    build: {
      outDir: env.VITE_BUILD_OUT_DIR || 'dist',
      sourcemap: mode !== 'production',
    },
  }
})
