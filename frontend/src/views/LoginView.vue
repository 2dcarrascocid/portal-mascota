<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BotonesSociales from '../components/BotonesSociales.vue'
import EstadoSistema from '../components/EstadoSistema.vue'
import { useAuth } from '../composables/useAuth'
import { mensajeError } from '../services/api'

const route = useRoute()
const router = useRouter()
const { loginConEmail, reenviarVerificacion } = useAuth()

const email = ref('')
const password = ref('')
const error = ref('')
const ingresando = ref(false)
// Cuenta creada pero sin confirmar: se ofrece reenviar el correo.
const sinConfirmar = ref(false)
const aviso = ref('')

async function ingresar() {
  error.value = ''
  aviso.value = ''
  sinConfirmar.value = false
  ingresando.value = true
  try {
    await loginConEmail(email.value.trim(), password.value)
    // El guard manda a /entidad si aún no tiene organización.
    router.replace(route.query.redirect || { name: 'inicio' })
  } catch (err) {
    error.value = mensajeError(err)
    sinConfirmar.value = err.response?.status === 403 && /confirmar/i.test(error.value)
  } finally {
    ingresando.value = false
  }
}

async function reenviar() {
  try {
    aviso.value = await reenviarVerificacion(email.value.trim())
    error.value = ''
    sinConfirmar.value = false
  } catch (err) {
    error.value = mensajeError(err)
  }
}
</script>

<template>
  <main class="auth">
    <div class="tarjeta">
      <div class="marca">🐾</div>
      <h1>Portal Animal</h1>
      <p class="suave">Ingresa a tu cuenta</p>

      <form class="formulario" @submit.prevent="ingresar">
        <label>
          Email
          <input v-model="email" type="email" autocomplete="email" required />
        </label>
        <label>
          Contraseña
          <input v-model="password" type="password" autocomplete="current-password" required />
        </label>
        <button :disabled="ingresando">{{ ingresando ? 'Ingresando…' : 'Ingresar' }}</button>
        <RouterLink :to="{ name: 'recuperar' }" class="olvido">¿Olvidaste tu contraseña?</RouterLink>
      </form>

      <div class="separador"><span>o</span></div>

      <BotonesSociales :redirect="route.query.redirect" @error="(m) => (error = m)" />

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button v-if="sinConfirmar" type="button" class="secundario" @click="reenviar">Reenviar correo de confirmación</button>
      <p v-if="aviso" class="suave">{{ aviso }}</p>

      <p class="suave pie">
        ¿No tienes cuenta?
        <RouterLink :to="{ name: 'registro', query: route.query }">Crear cuenta</RouterLink>
      </p>
    </div>

    <EstadoSistema />
  </main>
</template>

<style scoped>
.olvido {
  font-size: 0.85rem;
  justify-self: end;
}
</style>
