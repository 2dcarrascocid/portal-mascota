<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import MapaSucursales from '../components/MapaSucursales.vue'
import UbicacionSucursal from '../components/UbicacionSucursal.vue'
import { useAuth } from '../composables/useAuth'
import { useBranches } from '../composables/useBranches'
import { miUbicacion } from '../composables/useGeo'
import { mensajeError } from '../services/api'

const { esAdminOrg, puede } = useAuth()
const { items: sucursales, cargando, error, cargar, crear, actualizar, eliminar } = useBranches()

// ── Búsqueda ─────────────────────────────────────────────────
// q: nombre, dirección, comuna o región. cerca: { latitude, longitude } para
// ordenar por distancia.
const busqueda = ref('')
const cerca = ref(null)
const seleccion = ref('')

function recargar() {
  return cargar({
    ...(busqueda.value.trim() && { q: busqueda.value.trim() }),
    ...(cerca.value && { lat: cerca.value.latitude, lng: cerca.value.longitude }),
  })
}
onMounted(recargar)

let espera
watch(busqueda, () => {
  clearTimeout(espera)
  espera = setTimeout(recargar, 300)
})

async function ordenarPorCercania() {
  error.value = ''
  try {
    cerca.value = await miUbicacion()
    await recargar()
  } catch (err) {
    error.value = err.message
  }
}

function quitarCercania() {
  cerca.value = null
  recargar()
}

const puntos = computed(() =>
  sucursales.value.map((s) => ({
    id: s.id,
    latitude: s.latitude,
    longitude: s.longitude,
    titulo: s.name,
    detalle: [s.address, s.city].filter(Boolean).join(', '),
  }))
)
const sinUbicacion = computed(() => sucursales.value.filter((s) => s.latitude == null).length)

const distancia = (km) => (km == null ? '—' : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`)

// ── Formulario ───────────────────────────────────────────────
const vacia = () => ({
  name: '',
  address: '',
  city: '',
  region: '',
  ubicacion: null,
  phone: '',
  email: '',
  is_active: true,
})
const form = reactive(vacia())
const editando = ref(null) // id en edición, o null para crear
const mostrarForm = ref(false)
const errorForm = ref('')
const guardando = ref(false)

function nueva() {
  Object.assign(form, vacia())
  editando.value = null
  errorForm.value = ''
  mostrarForm.value = true
}

function editar(s) {
  Object.assign(form, {
    name: s.name,
    address: s.address ?? '',
    city: s.city ?? '',
    region: s.region ?? '',
    ubicacion: s.latitude == null ? null : { latitude: s.latitude, longitude: s.longitude },
    phone: s.phone ?? '',
    email: s.email ?? '',
    is_active: s.is_active,
  })
  editando.value = s.id
  errorForm.value = ''
  mostrarForm.value = true
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// Dirección propuesta por la búsqueda o el punto del mapa.
function aplicarDireccion(lugar) {
  if (lugar.direccion) form.address = lugar.direccion
  if (lugar.ciudad) form.city = lugar.ciudad
  if (lugar.region) form.region = lugar.region
}

const datosDe = ({ ubicacion, ...resto }) => ({
  ...resto,
  latitude: ubicacion?.latitude ?? null,
  longitude: ubicacion?.longitude ?? null,
})

async function guardar() {
  errorForm.value = ''
  guardando.value = true
  try {
    if (editando.value) await actualizar(editando.value, datosDe(form))
    else await crear(datosDe(form))
    mostrarForm.value = false
  } catch (err) {
    errorForm.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}

async function cambiarEstado(s) {
  try {
    await actualizar(s.id, { ...s, is_active: !s.is_active })
  } catch (err) {
    error.value = mensajeError(err)
  }
}

async function borrar(s) {
  if (!confirm(`¿Eliminar la sucursal "${s.name}"? Se quitarán sus asignaciones de personal y agendas.`)) return
  try {
    await eliminar(s.id)
  } catch (err) {
    error.value = mensajeError(err)
  }
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Sucursales</h1>
      <button v-if="puede('sucursales.crear') && !mostrarForm" @click="nueva">+ Nueva sucursal</button>
    </div>

    <form v-if="mostrarForm" class="panel" @submit.prevent="guardar">
      <h2>{{ editando ? 'Editar sucursal' : 'Nueva sucursal' }}</h2>
      <div class="grilla-form">
        <label>Nombre <input v-model="form.name" required maxlength="120" /></label>
        <label>Teléfono <input v-model="form.phone" type="tel" /></label>
        <label>Email <input v-model="form.email" type="email" /></label>
        <UbicacionSucursal
          :key="editando || 'nueva'"
          v-model="form.ubicacion"
          :direccion-inicial="[form.address, form.city].filter(Boolean).join(', ')"
          class="ancho-completo"
          @direccion="aplicarDireccion"
        />
        <label class="ancho-completo">Dirección <input v-model="form.address" /></label>
        <label>Comuna / ciudad <input v-model="form.city" maxlength="120" /></label>
        <label>Región <input v-model="form.region" maxlength="120" /></label>
        <label class="check"><input v-model="form.is_active" type="checkbox" /> Activa</label>
      </div>
      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
        <button type="button" class="secundario" @click="mostrarForm = false">Cancelar</button>
      </div>
    </form>

    <div class="filtros">
      <label style="flex: 1; min-width: 220px">
        Buscar
        <input v-model="busqueda" type="search" placeholder="Nombre, dirección, comuna o región" />
      </label>
      <button v-if="!cerca" type="button" class="secundario" @click="ordenarPorCercania">📍 Más cercanas a mí</button>
      <button v-else type="button" class="secundario" @click="quitarCercania">Quitar orden por cercanía</button>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <MapaSucursales
      v-if="!mostrarForm && sucursales.length"
      :puntos="puntos"
      :posicion="cerca"
      :seleccion="seleccion"
      alto="300px"
      @elegir="seleccion = $event"
    />
    <small v-if="!mostrarForm && sinUbicacion" class="suave">
      {{ sinUbicacion }} sucursal(es) sin ubicación: edítalas para marcarlas en el mapa.
    </small>

    <section class="panel tabla-contenedor">
      <p v-if="cargando" class="vacio">Cargando…</p>
      <p v-else-if="!sucursales.length" class="vacio">
        {{
          busqueda
            ? 'Ninguna sucursal coincide con la búsqueda.'
            : esAdminOrg
              ? 'Aún no hay sucursales. Crea la primera.'
              : 'No tienes sucursales asignadas.'
        }}
      </p>
      <table v-else class="tabla">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Dirección</th>
            <th v-if="cerca">Distancia</th>
            <th>Contacto</th>
            <th>Estado</th>
            <th v-if="puede('sucursales.editar') || puede('sucursales.eliminar')"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in sucursales" :key="s.id" :class="{ seleccionada: s.id === seleccion }">
            <td>
              <strong>{{ s.name }}</strong>
              <div>
                <button
                  v-if="s.latitude != null"
                  type="button"
                  class="enlace"
                  @click="seleccion = s.id"
                >
                  Ver en el mapa
                </button>
                <small v-else class="suave">Sin ubicación</small>
              </div>
            </td>
            <td>
              {{ s.address || '—' }}
              <div v-if="s.city || s.region"><small class="suave">{{ [s.city, s.region].filter(Boolean).join(', ') }}</small></div>
            </td>
            <td v-if="cerca">{{ distancia(s.distancia_km) }}</td>
            <td>
              <div>{{ s.phone || '' }}</div>
              <small class="suave">{{ s.email || '' }}</small>
            </td>
            <td>
              <span class="chip" :class="{ gris: !s.is_active }">{{ s.is_active ? 'Activa' : 'Inactiva' }}</span>
            </td>
            <td v-if="puede('sucursales.editar') || puede('sucursales.eliminar')">
              <div class="acciones">
                <button v-if="puede('sucursales.editar')" class="secundario pequeno" @click="editar(s)">Editar</button>
                <button v-if="puede('sucursales.editar')" class="secundario pequeno" @click="cambiarEstado(s)">
                  {{ s.is_active ? 'Desactivar' : 'Activar' }}
                </button>
                <button v-if="puede('sucursales.eliminar')" class="peligro pequeno" @click="borrar(s)">Eliminar</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>

<style scoped>
button.enlace {
  padding: 0;
  border: 0;
  background: none;
  color: var(--acento);
  font-size: 0.85rem;
  text-decoration: underline;
}
button.enlace:hover:not(:disabled) {
  background: none;
}
tr.seleccionada td {
  background: var(--acento-bg);
}
</style>
