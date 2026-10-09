<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useSpecialties } from '../composables/useSpecialties'
import { CATEGORIAS_SERVICIO } from '../lib/catalogos'
import { mensajeError } from '../services/api'

const { esAdminOrg } = useAuth()
const { items: especialidades, cargando, error, cargar, crear, actualizar, eliminar } = useSpecialties()

onMounted(cargar)

// Filtro por área: '' = todas, 'GENERAL' = sin área.
const area = ref('')
const busqueda = ref('')
const visibles = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  return especialidades.value.filter((e) => {
    if (area.value === 'GENERAL' && e.category) return false
    if (area.value && area.value !== 'GENERAL' && e.category !== area.value) return false
    return !q || e.name.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q)
  })
})

// ── Formulario ───────────────────────────────────────────────
const vacio = () => ({ name: '', category: '', description: '', is_active: true })
const form = reactive(vacio())
const editando = ref(null)
const mostrarForm = ref(false)
const errorForm = ref('')
const guardando = ref(false)

function nueva() {
  Object.assign(form, vacio(), area.value && area.value !== 'GENERAL' ? { category: area.value } : {})
  editando.value = null
  errorForm.value = ''
  mostrarForm.value = true
}

function editar(e) {
  Object.assign(form, { name: e.name, category: e.category ?? '', description: e.description ?? '', is_active: e.is_active })
  editando.value = e.id
  errorForm.value = ''
  mostrarForm.value = true
}

async function guardar() {
  errorForm.value = ''
  guardando.value = true
  const datos = { ...form, category: form.category || null }
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

async function borrar(e) {
  const detalle = e.total_personal ? ` Se quitará a ${e.total_personal} persona(s) que la tienen asignada.` : ''
  if (!confirm(`¿Eliminar la especialidad "${e.name}"?${detalle}`)) return
  try {
    await eliminar(e.id)
  } catch (err) {
    error.value = mensajeError(err)
  }
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Especialidades</h1>
      <button v-if="esAdminOrg && !mostrarForm" @click="nueva">+ Nueva especialidad</button>
    </div>
    <p class="suave">
      Las especialidades se asignan a cada integrante en <RouterLink to="/personal">Personal</RouterLink>. El área
      sirve para ofrecer solo las que corresponden a cada rol (veterinario, peluquero, adiestrador).
    </p>

    <form v-if="mostrarForm" class="panel" @submit.prevent="guardar">
      <h2>{{ editando ? 'Editar especialidad' : 'Nueva especialidad' }}</h2>
      <div class="grilla-form">
        <label>Nombre <input v-model="form.name" required maxlength="80" placeholder="Ej: Dermatología" /></label>
        <label>
          Área
          <select v-model="form.category">
            <option value="">General (cualquier rol)</option>
            <option v-for="(etiqueta, valor) in CATEGORIAS_SERVICIO" :key="valor" :value="valor">{{ etiqueta }}</option>
          </select>
        </label>
        <label class="ancho-completo">
          Descripción
          <textarea v-model="form.description" rows="2" maxlength="500"></textarea>
        </label>
        <label class="check"><input v-model="form.is_active" type="checkbox" /> Activa (se puede asignar)</label>
      </div>
      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
        <button type="button" class="secundario" @click="mostrarForm = false">Cancelar</button>
      </div>
    </form>

    <div class="filtros">
      <label style="flex: 1; min-width: 200px">
        Buscar
        <input v-model="busqueda" type="search" placeholder="Nombre o descripción" />
      </label>
      <label>
        Área
        <select v-model="area">
          <option value="">Todas</option>
          <option v-for="(etiqueta, valor) in CATEGORIAS_SERVICIO" :key="valor" :value="valor">{{ etiqueta }}</option>
          <option value="GENERAL">General</option>
        </select>
      </label>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section class="panel tabla-contenedor">
      <p v-if="cargando" class="vacio">Cargando…</p>
      <p v-else-if="!visibles.length" class="vacio">
        {{ especialidades.length ? 'No hay especialidades con estos filtros.' : 'Aún no hay especialidades. Crea la primera.' }}
      </p>
      <table v-else class="tabla">
        <thead>
          <tr>
            <th>Especialidad</th>
            <th>Área</th>
            <th>Personal</th>
            <th v-if="esAdminOrg"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in visibles" :key="e.id" :style="{ opacity: e.is_active ? 1 : 0.55 }">
            <td>
              <strong>{{ e.name }}</strong>
              <span v-if="!e.is_active" class="chip gris">Inactiva</span>
              <div v-if="e.description"><small class="suave">{{ e.description }}</small></div>
            </td>
            <td>
              <span class="chip" :class="{ gris: !e.category }">{{ CATEGORIAS_SERVICIO[e.category] || 'General' }}</span>
            </td>
            <td>{{ e.total_personal || '—' }}</td>
            <td v-if="esAdminOrg">
              <div class="acciones">
                <button class="secundario pequeno" @click="editar(e)">Editar</button>
                <button class="peligro pequeno" @click="borrar(e)">Eliminar</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>
