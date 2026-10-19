<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

// Botón "Acceder con Google" de Google Identity Services (librería oficial
// https://accounts.google.com/gsi/client). Google entrega un ID token firmado
// (`credential`) que se emite con @credencial; el backend lo verifica.
// Requiere VITE_GOOGLE_CLIENT_ID y que el origen del frontend esté en
// "Orígenes autorizados de JavaScript" del client en Google Cloud.
const emit = defineEmits(['credencial', 'error'])

const SCRIPT = 'https://accounts.google.com/gsi/client'
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
const contenedor = ref(null)
const cargando = ref(true)
let vigente = true

// La librería se carga una sola vez por página.
let cargaScript
function cargarLibreria() {
  if (window.google?.accounts?.id) return Promise.resolve()
  cargaScript ??= new Promise((resolver, rechazar) => {
    const s = document.createElement('script')
    s.src = SCRIPT
    s.async = true
    s.defer = true
    s.onload = resolver
    s.onerror = () => {
      cargaScript = null
      rechazar(new Error('No se pudo cargar el ingreso con Google. Revisa tu conexión.'))
    }
    document.head.appendChild(s)
  })
  return cargaScript
}

onMounted(async () => {
  if (!clientId) {
    cargando.value = false
    emit('error', 'El ingreso con Google no está configurado (falta VITE_GOOGLE_CLIENT_ID).')
    return
  }
  try {
    await cargarLibreria()
    if (!vigente) return
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: ({ credential }) => emit('credencial', credential),
      ux_mode: 'popup',
      context: 'signin',
    })
    window.google.accounts.id.renderButton(contenedor.value, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      locale: 'es',
      width: Math.min(contenedor.value.clientWidth || 320, 400),
    })
  } catch (err) {
    emit('error', err.message)
  } finally {
    cargando.value = false
  }
})

onBeforeUnmount(() => {
  vigente = false
  window.google?.accounts?.id?.cancel()
})
</script>

<template>
  <div class="google">
    <div ref="contenedor" class="boton"></div>
    <p v-if="cargando" class="suave">Cargando Google…</p>
  </div>
</template>

<style scoped>
.google {
  display: grid;
  justify-items: center;
  min-height: 44px;
}
.boton {
  width: 100%;
  display: flex;
  justify-content: center;
}
.google p {
  margin: 0;
  font-size: 0.85rem;
}
</style>
