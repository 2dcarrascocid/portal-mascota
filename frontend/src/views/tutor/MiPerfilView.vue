<script setup>
import { onMounted, reactive, ref } from 'vue'
import UbicacionSucursal from '../../components/UbicacionSucursal.vue'
import { useAuth } from '../../composables/useAuth'
import { usePortal } from '../../composables/usePortal'
import { formatearRut, rutValido } from '../../lib/rut'
import { mensajeError } from '../../services/api'

// Datos principales del tutor y su dirección geolocalizada (para buscar las
// sucursales más cercanas).
const { cargarUsuario } = useAuth()
const { cargarPerfil, guardarPerfil } = usePortal()

const form = reactive({
  national_id: '',
  first_name: '',
  last_name: '',
  phone: '',
  address: '',
  city: '',
  region: '',
})
const posicion = ref(null)
const email = ref('')
const avatar = ref('')
const cargando = ref(true)
const guardando = ref(false)
const error = ref('')
const aviso = ref('')

onMounted(async () => {
  try {
    const data = await cargarPerfil()
    email.value = data.email
    avatar.value = data.avatar_url
    const p = data.perfil
    for (const k of Object.keys(form)) form[k] = p[k] ?? ''
    form.national_id = p.national_id ? formatearRut(p.national_id) : ''
    posicion.value = p.latitude != null ? { latitude: p.latitude, longitude: p.longitude } : null
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
})

// La búsqueda o el punto del mapa proponen dirección, comuna y región.
function usarDireccion(lugar) {
  if (lugar.direccion) form.address = lugar.direccion
  if (lugar.ciudad) form.city = lugar.ciudad
  if (lugar.region) form.region = lugar.region
}

async function guardar() {
  error.value = ''
  aviso.value = ''
  if (form.national_id && !rutValido(form.national_id)) {
    error.value = 'El RUT no es válido (revisa el dígito verificador)'
    return
  }
  guardando.value = true
  try {
    const p = await guardarPerfil({
      ...form,
      latitude: posicion.value?.latitude ?? null,
      longitude: posicion.value?.longitude ?? null,
    })
    form.national_id = p.national_id ? formatearRut(p.national_id) : ''
    aviso.value = 'Perfil guardado'
    cargarUsuario() // actualiza el nombre de la barra
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Mi perfil</h1>
    </div>

    <p v-if="cargando" class="suave">Cargando…</p>
    <form v-else class="pagina" @submit.prevent="guardar">
      <section class="panel">
        <h2>Datos principales</h2>
        <div class="cuenta">
          <img v-if="avatar" :src="avatar" alt="" referrerpolicy="no-referrer" />
          <span>
            {{ email }}
            <small class="suave">Cuenta de Google</small>
          </span>
        </div>
        <div class="grilla-form">
          <label>Nombres <input v-model="form.first_name" required maxlength="80" autocomplete="given-name" /></label>
          <label>Apellidos <input v-model="form.last_name" required maxlength="80" autocomplete="family-name" /></label>
          <label>
            RUT
            <input
              v-model="form.national_id"
              maxlength="12"
              placeholder="12.345.678-9"
              @blur="form.national_id = formatearRut(form.national_id)"
            />
          </label>
          <label>Teléfono <input v-model="form.phone" type="tel" maxlength="40" autocomplete="tel" placeholder="+56 9 1234 5678" /></label>
        </div>
      </section>

      <section class="panel">
        <h2>Dirección</h2>
        <div class="grilla-form">
          <label class="ancho-completo">Dirección <input v-model="form.address" autocomplete="street-address" /></label>
          <label>Comuna / ciudad <input v-model="form.city" maxlength="120" /></label>
          <label>Región <input v-model="form.region" maxlength="120" /></label>
          <div class="ancho-completo">
            <UbicacionSucursal v-model="posicion" :direccion-inicial="form.address" @direccion="usarDireccion" />
            <p class="suave nota">Usamos este punto para mostrarte las sucursales más cercanas. No se comparte con otros usuarios.</p>
          </div>
        </div>
      </section>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="aviso" class="ok" role="status">✓ {{ aviso }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar perfil' }}</button>
      </div>
    </form>
  </main>
</template>

<style scoped>
.cuenta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.cuenta img {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}
.cuenta span {
  display: grid;
}
.nota {
  font-size: 0.85rem;
  margin: 6px 0 0;
}
.ok {
  color: var(--ok);
  margin: 0;
}
</style>
