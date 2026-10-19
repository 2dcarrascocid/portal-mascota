<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BotonGoogle from '../components/BotonGoogle.vue'
import { useAuth } from '../composables/useAuth'
import { mensajeError } from '../services/api'

// Ingreso del tutor de mascotas: solo con su cuenta de Google. La primera
// vez se crea su cuenta (rol tutor) con el email verificado por Google.
const route = useRoute()
const router = useRouter()
const { loginConGoogle } = useAuth()

const error = ref('')
const ingresando = ref(false)

async function alRecibir(credential) {
  error.value = ''
  ingresando.value = true
  try {
    await loginConGoogle(credential)
    router.replace(route.query.redirect || { name: 'mi-inicio' })
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    ingresando.value = false
  }
}
</script>

<template>
  <main class="auth">
    <div class="tarjeta">
      <div class="marca">🐾</div>
      <h1>Portal Animal</h1>
      <p class="suave">Reserva horas, paga en línea y revisa el historial de tus mascotas.</p>

      <p v-if="ingresando" class="suave">Ingresando…</p>
      <BotonGoogle v-else @credencial="alRecibir" @error="(m) => (error = m)" />

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <p class="suave pie">
        ¿Trabajas en una veterinaria o centro?
        <RouterLink :to="{ name: 'login' }">Ingreso del personal</RouterLink>
      </p>
    </div>
  </main>
</template>
