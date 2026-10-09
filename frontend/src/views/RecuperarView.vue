<script setup>
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { mensajeError } from '../services/api'

const { recuperarPassword } = useAuth()

const email = ref('')
const aviso = ref('')
const error = ref('')
const enviando = ref(false)

async function enviar() {
  error.value = ''
  enviando.value = true
  try {
    aviso.value = await recuperarPassword(email.value.trim())
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
      <h1>Recuperar contraseña</h1>

      <p v-if="aviso" class="suave">{{ aviso }}</p>

      <template v-else>
        <p class="suave">Te enviaremos un enlace para crear una contraseña nueva.</p>
        <form class="formulario" @submit.prevent="enviar">
          <label>
            Email
            <input v-model="email" type="email" autocomplete="email" required />
          </label>
          <button :disabled="enviando">{{ enviando ? 'Enviando…' : 'Enviar enlace' }}</button>
        </form>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </template>

      <p class="suave pie"><RouterLink :to="{ name: 'login' }">Volver a ingresar</RouterLink></p>
    </div>
  </main>
</template>
