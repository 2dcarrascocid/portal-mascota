<script setup>
import { computed, onMounted, ref } from 'vue'
import MapaSucursales from '../../components/MapaSucursales.vue'
import { miUbicacion } from '../../composables/useGeo'
import { usePortal } from '../../composables/usePortal'
import { mensajeError } from '../../services/api'

// Sucursales de todas las entidades, de la más cercana a la más lejana:
// desde la dirección del perfil o desde la ubicación actual del dispositivo.
const { buscarSucursales } = usePortal()

const sucursales = ref([])
const punto = ref(null)
const origen = ref('perfil') // 'perfil' | 'dispositivo'
const busqueda = ref('')
const seleccion = ref('')
const cargando = ref(false)
const error = ref('')

async function cargar(ubicacion = origen.value === 'dispositivo' ? punto.value : null) {
  error.value = ''
  cargando.value = true
  try {
    const data = await buscarSucursales({ punto: ubicacion, q: busqueda.value.trim() })
    sucursales.value = data.sucursales
    punto.value = data.punto
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
}

async function usarDispositivo() {
  error.value = ''
  try {
    const p = await miUbicacion()
    origen.value = 'dispositivo'
    await cargar(p)
  } catch (err) {
    error.value = err.message
  }
}

function usarPerfil() {
  origen.value = 'perfil'
  cargar(null)
}

onMounted(() => cargar(null))

const puntos = computed(() =>
  sucursales.value.map((s) => ({
    id: s.id,
    latitude: s.latitude,
    longitude: s.longitude,
    titulo: `${s.organization?.name} — ${s.name}`,
    detalle: [s.address, s.city].filter(Boolean).join(', '),
  }))
)

const distancia = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`)
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Sucursales cercanas</h1>
    </div>

    <section class="panel filtros">
      <label class="busqueda">
        Buscar por nombre, comuna o entidad
        <input v-model="busqueda" type="search" placeholder="Ej: Providencia" @keydown.enter.prevent="cargar()" />
      </label>
      <button class="secundario" :disabled="cargando" @click="cargar()">Buscar</button>
      <button class="secundario" :class="{ activo: origen === 'dispositivo' }" @click="usarDispositivo">📍 Usar mi ubicación actual</button>
      <button v-if="origen === 'dispositivo'" class="secundario" @click="usarPerfil">🏠 Desde mi dirección</button>
    </section>

    <p v-if="!punto && !cargando" class="panel aviso">
      Sin ubicación de referencia: <RouterLink :to="{ name: 'mi-perfil' }">agrega tu dirección en el perfil</RouterLink>
      o usa tu ubicación actual para ordenarlas por cercanía.
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <MapaSucursales :puntos="puntos" :posicion="punto" :seleccion="seleccion" alto="340px" @elegir="(id) => (seleccion = id)" />

    <p v-if="cargando" class="suave">Buscando sucursales…</p>
    <p v-else-if="!sucursales.length" class="panel vacio">No encontramos sucursales con esos criterios.</p>
    <ul v-else class="lista">
      <li
        v-for="s in sucursales"
        :key="s.id"
        class="panel sucursal"
        :class="{ elegida: s.id === seleccion }"
        @click="seleccion = s.id"
      >
        <div class="datos">
          <strong>{{ s.organization?.name }} — {{ s.name }}</strong>
          <span class="suave">{{ [s.address, s.city, s.region].filter(Boolean).join(', ') }}</span>
          <small v-if="s.phone" class="suave">☎ {{ s.phone }}</small>
        </div>
        <div class="lado">
          <span v-if="s.distancia_km != null" class="chip">{{ distancia(s.distancia_km) }}</span>
          <RouterLink :to="{ name: 'mi-reservar', query: { sucursal: s.id } }" class="reservar" @click.stop>Reservar</RouterLink>
        </div>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.busqueda {
  flex: 1;
  min-width: 220px;
}
.activo {
  border-color: var(--acento);
  color: var(--acento);
}
.aviso {
  border-left: 4px solid var(--aviso);
  margin: 0;
}
.lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.sucursal {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  padding: 12px 16px;
}
.sucursal.elegida {
  border-color: var(--acento);
}
.datos {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.lado {
  display: grid;
  justify-items: end;
  align-content: space-between;
  gap: 8px;
}
.reservar {
  font-weight: 600;
  white-space: nowrap;
}
</style>
