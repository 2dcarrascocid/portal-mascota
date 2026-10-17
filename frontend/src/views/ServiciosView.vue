<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useServices } from '../composables/useServices'
import { useSpecialties } from '../composables/useSpecialties'
import { CATEGORIAS_SERVICIO } from '../lib/catalogos'
import { mensajeError } from '../services/api'

const { puede } = useAuth()
const { items: servicios, cargando, error, cargar, crear, actualizar, eliminar } = useServices()
const { items: especialidades, cargar: cargarEspecialidades } = useSpecialties()

const route = useRoute()
const categoria = ref('') // filtro: '' = todas
const especialidad = ref(route.query.especialidad || '') // filtro: '' = todas, 'NINGUNA' = sin asignar
onMounted(() => Promise.all([cargar(), cargarEspecialidades()]))

const visibles = computed(() =>
  servicios.value.filter((s) => {
    if (categoria.value && s.category !== categoria.value) return false
    if (especialidad.value === 'NINGUNA') return !s.specialty_ids.length
    return !especialidad.value || s.specialty_ids.includes(especialidad.value)
  })
)

const precio = (n) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n)
const nombreEspecialidad = (id) => especialidades.value.find((e) => e.id === id)?.name ?? ''
const puedeModificar = computed(() => puede('servicios.editar') || puede('servicios.eliminar'))

// ── Formulario ───────────────────────────────────────────────
const vacio = () => ({
  category: categoria.value || 'GROOMING',
  name: '',
  description: '',
  price: 0,
  duration_minutes: 60,
  is_active: true,
  specialtyIds: especialidad.value && especialidad.value !== 'NINGUNA' ? [especialidad.value] : [],
})
const form = reactive(vacio())
const editando = ref(null)
const mostrarForm = ref(false)
const errorForm = ref('')
const guardando = ref(false)

// Especialidades ofrecidas: activas, más las ya asignadas (para no perderlas
// en silencio).
const especialidadesDelTipo = computed(() =>
  especialidades.value.filter((e) => form.specialtyIds.includes(e.id) || e.is_active)
)

function nuevo() {
  Object.assign(form, vacio())
  editando.value = null
  errorForm.value = ''
  mostrarForm.value = true
}

function editar(s) {
  const { specialty_ids: ids, ...datos } = s
  Object.assign(form, { ...datos, description: s.description ?? '', specialtyIds: [...ids] })
  editando.value = s.id
  errorForm.value = ''
  mostrarForm.value = true
}

async function guardar() {
  errorForm.value = ''
  guardando.value = true
  const { id, ...datos } = form
  try {
    if (editando.value) await actualizar(editando.value, datos)
    else await crear(datos)
    mostrarForm.value = false
    cargarEspecialidades() // actualiza el conteo de servicios por especialidad
  } catch (err) {
    errorForm.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}

async function borrar(s) {
  if (!confirm(`¿Eliminar el servicio "${s.name}"?`)) return
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
      <h1>Catálogo de servicios</h1>
      <button v-if="puede('servicios.crear') && !mostrarForm" @click="nuevo">+ Nuevo servicio</button>
    </div>
    <p class="suave">
      Cada servicio se asigna a las especialidades que lo pueden realizar; así, al agendar, se ofrecen los
      profesionales que tienen esa especialidad.
    </p>

    <div class="acciones" role="tablist">
      <button
        role="tab"
        :aria-selected="!categoria"
        :class="{ secundario: categoria }"
        class="pequeno"
        @click="categoria = ''"
      >
        Todos
      </button>
      <button
        v-for="(etiqueta, valor) in CATEGORIAS_SERVICIO"
        :key="valor"
        role="tab"
        :aria-selected="categoria === valor"
        :class="{ secundario: categoria !== valor }"
        class="pequeno"
        @click="categoria = valor"
      >
        {{ etiqueta }}
      </button>
    </div>

    <div v-if="especialidades.length" class="filtros">
      <label>
        Especialidad
        <select v-model="especialidad">
          <option value="">Todas</option>
          <option v-for="e in especialidades" :key="e.id" :value="e.id">{{ e.name }}</option>
          <option value="NINGUNA">Sin especialidad asignada</option>
        </select>
      </label>
    </div>

    <form v-if="mostrarForm" class="panel" @submit.prevent="guardar">
      <h2>{{ editando ? 'Editar servicio' : 'Nuevo servicio' }}</h2>
      <div class="grilla-form">
        <label>
          Tipo
          <select v-model="form.category" required>
            <option v-for="(etiqueta, valor) in CATEGORIAS_SERVICIO" :key="valor" :value="valor">{{ etiqueta }}</option>
          </select>
        </label>
        <label>Nombre <input v-model="form.name" required maxlength="120" /></label>
        <label>Precio (CLP) <input v-model.number="form.price" type="number" min="0" step="1" required /></label>
        <label>
          Duración (min)
          <input v-model.number="form.duration_minutes" type="number" min="5" max="1440" step="5" required />
        </label>
        <label class="ancho-completo">
          Descripción
          <textarea v-model="form.description" rows="2" maxlength="1000"></textarea>
        </label>
        <div class="campo ancho-completo">
          Especialidades que lo realizan
          <div v-if="especialidadesDelTipo.length" class="chips">
            <label v-for="e in especialidadesDelTipo" :key="e.id" class="check">
              <input v-model="form.specialtyIds" type="checkbox" :value="e.id" />
              {{ e.name }}
            </label>
          </div>
          <small class="suave">
            {{ especialidadesDelTipo.length ? '' : 'No hay especialidades para este tipo. ' }}
            <RouterLink :to="{ name: 'config-especialidades' }">Administrar especialidades</RouterLink>
          </small>
        </div>
        <label class="check"><input v-model="form.is_active" type="checkbox" /> Activo</label>
      </div>
      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
        <button type="button" class="secundario" @click="mostrarForm = false">Cancelar</button>
      </div>
    </form>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section class="panel tabla-contenedor">
      <p v-if="cargando" class="vacio">Cargando…</p>
      <p v-else-if="!visibles.length" class="vacio">No hay servicios con estos filtros.</p>
      <table v-else class="tabla">
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Tipo</th>
            <th>Especialidades</th>
            <th>Duración</th>
            <th>Precio</th>
            <th v-if="puedeModificar"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in visibles" :key="s.id" :style="{ opacity: s.is_active ? 1 : 0.55 }">
            <td>
              <strong>{{ s.name }}</strong>
              <span v-if="!s.is_active" class="chip gris">Inactivo</span>
              <div v-if="s.description"><small class="suave">{{ s.description }}</small></div>
            </td>
            <td><span class="chip">{{ CATEGORIAS_SERVICIO[s.category] }}</span></td>
            <td>
              <div v-if="s.specialty_ids.length" class="chips">
                <span v-for="id in s.specialty_ids" :key="id" class="chip gris">{{ nombreEspecialidad(id) }}</span>
              </div>
              <span v-else class="suave">—</span>
            </td>
            <td>{{ s.duration_minutes }} min</td>
            <td>{{ precio(s.price) }}</td>
            <td v-if="puedeModificar">
              <div class="acciones">
                <button v-if="puede('servicios.editar')" class="secundario pequeno" @click="editar(s)">Editar</button>
                <button v-if="puede('servicios.eliminar')" class="peligro pequeno" @click="borrar(s)">Eliminar</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>
