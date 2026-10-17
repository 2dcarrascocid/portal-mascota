<script setup>
import { computed, ref } from 'vue'
import { buscarTutores } from '../../composables/useAppointments'
import { mensajeError } from '../../services/api'

// Elegir tutor (y opcionalmente una de sus mascotas) de las fichas registradas.
// v-model:tutor = objeto tutor con pets | null ; v-model:mascota = id | ''
const tutor = defineModel('tutor', { type: Object, default: null })
const mascota = defineModel('mascota', { type: String, default: '' })

const busqueda = ref('')
const resultados = ref([])
const buscando = ref(false)
const error = ref('')
const buscado = ref(false)

async function buscar() {
  error.value = ''
  buscando.value = true
  try {
    resultados.value = await buscarTutores(busqueda.value.trim())
    buscado.value = true
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    buscando.value = false
  }
}

function elegir(t) {
  tutor.value = t
  mascota.value = t.pets?.length === 1 ? t.pets[0].id : ''
  resultados.value = []
}

function cambiar() {
  tutor.value = null
  mascota.value = ''
}

const nombre = (t) => `${t.first_name} ${t.last_name}`
const mascotas = computed(() => tutor.value?.pets ?? [])
</script>

<template>
  <div class="campo">
    <template v-if="!tutor">
      Tutor
      <div class="buscador">
        <input
          v-model="busqueda"
          type="search"
          placeholder="Nombre, teléfono, RUT, email o mascota"
          @keydown.enter.prevent="buscar"
        />
        <button type="button" class="secundario" :disabled="buscando" @click="buscar">
          {{ buscando ? 'Buscando…' : 'Buscar' }}
        </button>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <ul v-if="resultados.length" class="resultados">
        <li v-for="t in resultados" :key="t.id">
          <button type="button" class="secundario" @click="elegir(t)">
            <strong>{{ nombre(t) }}</strong>
            <small class="suave">
              {{ [t.national_id, t.phone].filter(Boolean).join(' · ') }}
              <template v-if="t.pets?.length"> · {{ t.pets.map((p) => p.name).join(', ') }}</template>
            </small>
          </button>
        </li>
      </ul>
      <small v-else-if="buscado" class="suave">
        No hay tutores con esa búsqueda. Puedes reservar sin ficha o
        <RouterLink to="/tutores">registrar al tutor</RouterLink>.
      </small>
    </template>

    <template v-else>
      <div class="elegido">
        <span>
          Tutor: <strong>{{ nombre(tutor) }}</strong>
          <small class="suave"> {{ [tutor.national_id, tutor.phone].filter(Boolean).join(' · ') }}</small>
        </span>
        <button type="button" class="secundario pequeno" @click="cambiar">Cambiar</button>
      </div>
      <label>
        Mascota
        <select v-model="mascota">
          <option value="">Sin indicar</option>
          <option v-for="p in mascotas" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <small v-if="!mascotas.length" class="suave">Este tutor no tiene mascotas registradas.</small>
      </label>
    </template>
  </div>
</template>

<style scoped>
.buscador {
  display: flex;
  gap: 8px;
}
.buscador input {
  flex: 1;
  min-width: 0;
}
.resultados {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
}
.resultados button {
  width: 100%;
  display: grid;
  text-align: left;
}
.elegido {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
