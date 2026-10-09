import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // Puerto fijo: debe coincidir con FRONTEND_URL del backend y con los orígenes autorizados en Google
  server: { port: 5173, strictPort: true },
})
