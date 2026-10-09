<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { mensajeError } from '../services/api'

const route = useRoute()
const router = useRouter()
const { verificarEmail, reenviarVerificacion } = useAuth()

const error = ref('')
const email = ref('')
const aviso = ref('')
const enviando = ref(false)

onMounted(async () => {
  const token = route.query.token
  // El token es de un solo uso: lo sacamos de la barra de direcciones.
  history.replaceState(history.state, '', window.location.pathname)
  try {
    await verificarEmail(token)
    router.replace({ name: 'inicio' })
  } catch (err) {
    error.value = mensajeError(err)
  }
})

async function reenviar() {
  enviando.value = true
  try {
    aviso.value = await reenviarVerificacion(email.value.trim())
  } catch (err) {
    aviso.value = mensajeError(err)
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <main class="auth">
    <div class="tarjeta">
      <template v-if="error">
        <div class="marca">⚠️</div>
        <h1>No se pudo confirmar tu email</h1>
        <p class="error" role="alert">{{ error }}</p>

        <form class="formulario" @submit.prevent="reenviar">
          <label>
            Pide un enlace nuevo
            <input v-model="email" type="email" autocomplete="email" placeholder="tu@email.com" required />
          </label>
          <button :disabled="enviando">{{ enviando ? 'Enviando…' : 'Reenviar correo' }}</button>
        </form>
        <p v-if="aviso" class="suave">{{ aviso }}</p>

        <RouterLink :to="{ name: 'login' }">Volver a ingresar</RouterLink>
      </template>
      <p v-else class="suave">Confirmando tu email…</p>
    </div>
  </main>
</template>
