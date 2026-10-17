<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useSpecies } from '../composables/useSpecies'
import { mensajeError } from '../services/api'

const { puede } = useAuth()
const { especies, cargando, error, cargar, crearEspecie, eliminarEspecie, crearRaza, eliminarRaza } = useSpecies()

const nuevaEspecie = ref('')
const nuevaRaza = reactive({}) // especieId -> texto
const errorAccion = ref('')

onMounted(cargar)

async function ejecutar(fn) {
  errorAccion.value = ''
  try {
    await fn()
  } catch (err) {
    errorAccion.value = mensajeError(err)
  }
}

const agregarEspecie = () =>
  ejecutar(async () => {
    await crearEspecie(nuevaEspecie.value.trim())
    nuevaEspecie.value = ''
  })

const agregarRaza = (e) =>
  ejecutar(async () => {
    await crearRaza(e.id, (nuevaRaza[e.id] || '').trim())
    nuevaRaza[e.id] = ''
  })

const quitarEspecie = (e) => {
  if (confirm(`¿Eliminar la especie "${e.name}" y sus razas?`)) ejecutar(() => eliminarEspecie(e.id))
}
const quitarRaza = (e, r) => {
  if (confirm(`¿Eliminar la raza "${r.name}"?`)) ejecutar(() => eliminarRaza(e.id, r.id))
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Especies y razas</h1>
    </div>
    <p class="suave">
      Las especies y razas base son comunes a todas las entidades. Puedes agregar las tuyas; solo esas se pueden
      eliminar.
    </p>

    <form v-if="puede('especies.crear')" class="panel filtros" @submit.prevent="agregarEspecie">
      <label>
        Nueva especie
        <input v-model="nuevaEspecie" placeholder="Ej: Conejo" required maxlength="60" />
      </label>
      <button>Agregar especie</button>
    </form>

    <p v-if="error || errorAccion" class="error" role="alert">{{ errorAccion || error }}</p>
    <p v-if="cargando" class="vacio">Cargando…</p>

    <section v-for="e in especies" :key="e.id" class="panel">
      <div class="pagina-cabecera">
        <h3 style="margin: 0">
          {{ e.name }}
          <span class="chip" :class="{ gris: !e.propia }">{{ e.propia ? 'Propia' : 'Base' }}</span>
        </h3>
        <button v-if="puede('especies.eliminar') && e.propia" class="peligro pequeno" @click="quitarEspecie(e)">Eliminar especie</button>
      </div>

      <div class="chips" style="margin: 12px 0">
        <span v-for="r in e.razas" :key="r.id" class="chip" :class="{ gris: !r.propia }">
          {{ r.name }}
          <button
            v-if="puede('especies.eliminar') && r.propia"
            type="button"
            :aria-label="`Eliminar ${r.name}`"
            @click="quitarRaza(e, r)"
          >
            ×
          </button>
        </span>
        <span v-if="!e.razas.length" class="suave">Sin razas</span>
      </div>

      <form v-if="puede('especies.crear')" class="filtros" @submit.prevent="agregarRaza(e)">
        <input v-model="nuevaRaza[e.id]" :placeholder="`Nueva raza de ${e.name.toLowerCase()}`" required maxlength="80" />
        <button class="secundario">Agregar raza</button>
      </form>
    </section>
  </main>
</template>
