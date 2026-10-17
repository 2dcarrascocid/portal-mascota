<script setup>
import { ref } from 'vue'
import { buscarDireccion, direccionDe, miUbicacion } from '../composables/useGeo'
import { mensajeError } from '../services/api'
import MapaSucursales from './MapaSucursales.vue'

// Ubicación de una sucursal: buscar la dirección, marcarla en el mapa (clic
// o arrastrar el marcador) o usar la ubicación del dispositivo.
// v-model = { latitude, longitude }; @direccion propone dirección/comuna/región.
const posicion = defineModel({ type: Object, default: null })
const props = defineProps({ direccionInicial: { type: String, default: '' } })
const emit = defineEmits(['direccion'])

const busqueda = ref(props.direccionInicial)
const resultados = ref([])
const buscando = ref(false)
const error = ref('')
const sugerencia = ref(null) // lugar del punto marcado a mano

async function buscar() {
  error.value = ''
  resultados.value = []
  if (busqueda.value.trim().length < 3) {
    error.value = 'Escribe al menos 3 caracteres'
    return
  }
  buscando.value = true
  try {
    resultados.value = await buscarDireccion(busqueda.value)
    if (!resultados.value.length) error.value = 'No encontramos esa dirección. Prueba agregando la comuna, o marca el punto en el mapa.'
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    buscando.value = false
  }
}

function elegir(lugar) {
  posicion.value = { latitude: lugar.latitude, longitude: lugar.longitude }
  emit('direccion', lugar)
  resultados.value = []
  sugerencia.value = null
}

// Al marcar a mano se busca la dirección del punto y se ofrece usarla.
async function marcar(nueva) {
  posicion.value = nueva
  sugerencia.value = null
  try {
    sugerencia.value = await direccionDe(nueva)
  } catch {
    // sin dirección: el punto queda igual
  }
}

async function usarMiUbicacion() {
  error.value = ''
  try {
    await marcar(await miUbicacion())
  } catch (err) {
    error.value = err.message
  }
}

function usarSugerencia() {
  emit('direccion', sugerencia.value)
  sugerencia.value = null
}

function quitar() {
  posicion.value = null
  sugerencia.value = null
}
</script>

<template>
  <div class="campo ubicacion">
    <span>Ubicación en el mapa</span>
    <div class="buscador">
      <input
        v-model="busqueda"
        type="search"
        placeholder="Buscar dirección, ej: Av. Providencia 1234, Providencia"
        @keydown.enter.prevent="buscar"
      />
      <button type="button" class="secundario" :disabled="buscando" @click="buscar">
        {{ buscando ? 'Buscando…' : 'Buscar' }}
      </button>
      <button type="button" class="secundario" @click="usarMiUbicacion">📍 Mi ubicación</button>
    </div>

    <ul v-if="resultados.length" class="resultados">
      <li v-for="(r, i) in resultados" :key="i">
        <button type="button" class="secundario" @click="elegir(r)">{{ r.etiqueta }}</button>
      </li>
    </ul>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <MapaSucursales :posicion="posicion" editable alto="280px" @update:posicion="marcar" />

    <div class="acciones">
      <small v-if="posicion" class="suave">
        {{ posicion.latitude.toFixed(6) }}, {{ posicion.longitude.toFixed(6) }} · arrastra el marcador o haz clic para
        ajustar
      </small>
      <small v-else class="suave">Sin ubicación: busca la dirección o haz clic en el mapa.</small>
      <button v-if="posicion" type="button" class="peligro pequeno" @click="quitar">Quitar ubicación</button>
    </div>
    <p v-if="sugerencia" class="sugerencia">
      <small>Dirección del punto: <strong>{{ sugerencia.etiqueta }}</strong></small>
      <button type="button" class="secundario pequeno" @click="usarSugerencia">
        Usar esta dirección
      </button>
    </p>
  </div>
</template>

<style scoped>
.ubicacion {
  gap: 8px !important;
}
.buscador {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.buscador input {
  flex: 1;
  min-width: 220px;
}
.resultados {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.resultados button {
  width: 100%;
  text-align: left;
  font-size: 0.85rem;
}
.sugerencia {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin: 0;
}
</style>
