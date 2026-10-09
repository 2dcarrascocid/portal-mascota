<script setup>
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { mensajeError } from '../services/api'

const props = defineProps({ redirect: { type: String, default: '' } })
const emit = defineEmits(['error'])

const { loginConProveedor } = useAuth()
const redirigiendo = ref('')

async function continuar(provider) {
  redirigiendo.value = provider
  try {
    await loginConProveedor(provider, props.redirect)
  } catch (err) {
    emit('error', mensajeError(err))
    redirigiendo.value = ''
  }
}
</script>

<template>
  <div class="sociales">
    <button type="button" class="secundario social" :disabled="!!redirigiendo" @click="continuar('google')">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {{ redirigiendo === 'google' ? 'Redirigiendo…' : 'Continuar con Google' }}
    </button>
    <button type="button" class="secundario social" :disabled="!!redirigiendo" @click="continuar('facebook')">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v2.9h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z" />
      </svg>
      {{ redirigiendo === 'facebook' ? 'Redirigiendo…' : 'Continuar con Facebook' }}
    </button>
  </div>
</template>

<style scoped>
.sociales {
  display: grid;
  gap: 8px;
}
.social {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 10px 16px;
}
.social svg {
  width: 20px;
  height: 20px;
  flex: none;
}
</style>
