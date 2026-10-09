<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BotonesSociales from '../components/BotonesSociales.vue'
import { useAuth } from '../composables/useAuth'
import { TIPOS_ORGANIZACION } from '../lib/catalogos'
import { mensajeError } from '../services/api'

const route = useRoute()
const router = useRouter()
const { registrarConEmail, listarOrganizacionesPublicas } = useAuth()

const fullName = ref('')
const email = ref('')
const password = ref('')
// ?org=<uuid> permite compartir un link de registro de una entidad.
const organizationId = ref(route.query.org || '')
const organizaciones = ref([])

const error = ref('')
const enviando = ref(false)
const confirmarEmail = ref(false)

onMounted(async () => {
  try {
    organizaciones.value = await listarOrganizacionesPublicas()
  } catch {
    // Sin directorio: la entidad se elige después de ingresar.
  }
})

async function registrar() {
  error.value = ''
  enviando.value = true
  try {
    const { requiereConfirmacion } = await registrarConEmail({
      email: email.value.trim(),
      password: password.value,
      fullName: fullName.value.trim(),
      organizationId: organizationId.value || null,
    })
    if (requiereConfirmacion) confirmarEmail.value = true
    else router.replace(route.query.redirect || { name: 'inicio' })
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <main class="auth">
    <div v-if="confirmarEmail" class="tarjeta">
      <div class="marca">📬</div>
      <h1>Revisa tu correo</h1>
      <p class="suave">
        Enviamos un enlace de confirmación a <strong>{{ email }}</strong>. Ábrelo para activar tu cuenta
        (vence en 24 horas).
      </p>
      <RouterLink :to="{ name: 'login' }">Volver a ingresar</RouterLink>
    </div>

    <div v-else class="tarjeta">
      <div class="marca">🐾</div>
      <h1>Crear cuenta</h1>

      <BotonesSociales :redirect="route.query.redirect" @error="(m) => (error = m)" />

      <div class="separador"><span>o con tu email</span></div>

      <form class="formulario" @submit.prevent="registrar">
        <label>
          Nombre completo
          <input v-model="fullName" autocomplete="name" required />
        </label>
        <label>
          Email
          <input v-model="email" type="email" autocomplete="email" required />
        </label>
        <label>
          Contraseña
          <input v-model="password" type="password" autocomplete="new-password" minlength="8" required />
        </label>
        <label v-if="organizaciones.length">
          Entidad <small class="suave">(opcional, puedes elegirla después)</small>
          <select v-model="organizationId">
            <option value="">Elegir después</option>
            <option v-for="o in organizaciones" :key="o.id" :value="o.id">
              {{ o.name }} · {{ TIPOS_ORGANIZACION[o.type] }}
            </option>
          </select>
        </label>
        <button :disabled="enviando">{{ enviando ? 'Creando cuenta…' : 'Crear cuenta' }}</button>
      </form>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <p class="suave pie">
        ¿Ya tienes cuenta?
        <RouterLink :to="{ name: 'login', query: { redirect: route.query.redirect } }">Ingresar</RouterLink>
      </p>
    </div>
  </main>
</template>
