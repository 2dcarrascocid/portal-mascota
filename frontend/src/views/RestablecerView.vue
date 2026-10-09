<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { mensajeError } from '../services/api'

const route = useRoute()
const router = useRouter()
const { restablecerPassword } = useAuth()

const token = route.query.token || ''
// Personal invitado por su entidad: primera contraseña.
const invitacion = route.query.invitacion === '1'
const password = ref('')
const confirmacion = ref('')
const error = ref('')
const enviando = ref(false)

// El token no debe quedar en el historial del navegador.
onMounted(() => history.replaceState(history.state, '', window.location.pathname))

async function guardar() {
  error.value = ''
  if (password.value !== confirmacion.value) {
    error.value = 'Las contraseñas no coinciden'
    return
  }
  enviando.value = true
  try {
    await restablecerPassword(token, password.value)
    router.replace({ name: 'inicio' })
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <main class="auth">
    <div class="tarjeta">
      <div class="marca">🔑</div>
      <h1>{{ invitacion ? 'Bienvenido/a: crea tu contraseña' : 'Nueva contraseña' }}</h1>

      <template v-if="token">
        <form class="formulario" @submit.prevent="guardar">
          <label>
            Contraseña nueva
            <input v-model="password" type="password" autocomplete="new-password" minlength="8" required />
          </label>
          <label>
            Repite la contraseña
            <input v-model="confirmacion" type="password" autocomplete="new-password" minlength="8" required />
          </label>
          <button :disabled="enviando">{{ enviando ? 'Guardando…' : 'Guardar e ingresar' }}</button>
        </form>
        <p v-if="!invitacion" class="suave nota">Se cerrará la sesión en tus otros dispositivos.</p>
      </template>
      <p v-else class="error">El enlace no es válido. Pide uno nuevo.</p>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p class="suave pie"><RouterLink :to="{ name: 'recuperar' }">Pedir otro enlace</RouterLink></p>
    </div>
  </main>
</template>

<style scoped>
.nota {
  font-size: 0.85rem;
}
</style>
