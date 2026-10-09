<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useServices } from '../composables/useServices'
import { CATEGORIAS_SERVICIO } from '../lib/catalogos'
import { mensajeError } from '../services/api'

const { esAdminOrg } = useAuth()
const { items: servicios, cargando, error, cargar, crear, actualizar, eliminar } = useServices()

const categoria = ref('') // filtro: '' = todas
onMounted(() => cargar())

const visibles = computed(() =>
  categoria.value ? servicios.value.filter((s) => s.category === categoria.value) : servicios.value
)

const precio = (n) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n)

// ── Formulario ───────────────────────────────────────────────
const vacio = () => ({
  category: categoria.value || 'GROOMING',
  name: '',
  description: '',
  price: 0,
  duration_minutes: 60,
  is_active: true,
})
const form = reactive(vacio())
const editando = ref(null)
const mostrarForm = ref(false)
const errorForm = ref('')
const guardando = ref(false)

function nuevo() {
  Object.assign(form, vacio())
  editando.value = null
  errorForm.value = ''
  mostrarForm.value = true
}

function editar(s) {
  Object.assign(form, { ...s, description: s.description ?? '' })
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
      <button v-if="esAdminOrg && !mostrarForm" @click="nuevo">+ Nuevo servicio</button>
    </div>

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
      <p v-else-if="!visibles.length" class="vacio">No hay servicios en esta categoría.</p>
      <table v-else class="tabla">
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Tipo</th>
            <th>Duración</th>
            <th>Precio</th>
            <th v-if="esAdminOrg"></th>
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
            <td>{{ s.duration_minutes }} min</td>
            <td>{{ precio(s.price) }}</td>
            <td v-if="esAdminOrg">
              <div class="acciones">
                <button class="secundario pequeno" @click="editar(s)">Editar</button>
                <button class="peligro pequeno" @click="borrar(s)">Eliminar</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>
