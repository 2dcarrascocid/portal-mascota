<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { mensajeError } from '../services/api'

const route = useRoute()
const router = useRouter()
const { completarCallback } = useAuth()

const error = ref('')

// Vuelta desde Google/Facebook: el backend deja la sesión (o el error) en el
// fragmento de la URL.
onMounted(async () => {
  const fragmento = window.location.hash
  // Saca los tokens de la barra de direcciones y del historial.
  history.replaceState(history.state, '', window.location.pathname + window.location.search)
  try {
    await completarCallback(route.query.error_description ? `error=${encodeURIComponent(route.query.error_description)}` : fragmento)
    router.replace(route.query.redirect || { name: 'inicio' })
  } catch (err) {
    error.value = mensajeError(err)
  }
})
</script>

<template>
  <main class="auth">
    <div class="tarjeta">
      <template v-if="error">
        <div class="marca">⚠️</div>
        <h1>No se pudo iniciar sesión</h1>
        <p class="error" role="alert">{{ error }}</p>
        <RouterLink :to="{ name: 'login' }">Volver a ingresar</RouterLink>
      </template>
      <p v-else class="suave">Ingresando…</p>
    </div>
  </main>
</template>
