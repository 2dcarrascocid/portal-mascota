import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // Puerto preferido 5173 (el de FRONTEND_URL del backend y los orígenes autorizados en Google).
  // Si está ocupado, Vite toma el siguiente libre (5174, 5175…); en ese puerto fallan CORS,
  // el ingreso con Google y las vueltas desde el backend (verificación de correo, Webpay).
  server: { port: 5173, strictPort: false },
})
