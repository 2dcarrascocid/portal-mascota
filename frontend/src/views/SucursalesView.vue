<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useBranches } from '../composables/useBranches'
import { mensajeError } from '../services/api'

const { esAdminOrg } = useAuth()
const { items: sucursales, cargando, error, cargar, crear, actualizar, eliminar } = useBranches()

const vacia = () => ({ name: '', address: '', phone: '', email: '', is_active: true })
const form = reactive(vacia())
const editando = ref(null) // id en edición, o null para crear
const mostrarForm = ref(false)
const errorForm = ref('')
const guardando = ref(false)

onMounted(cargar)

function nueva() {
  Object.assign(form, vacia())
  editando.value = null
  errorForm.value = ''
  mostrarForm.value = true
}

function editar(s) {
  Object.assign(form, { name: s.name, address: s.address ?? '', phone: s.phone ?? '', email: s.email ?? '', is_active: s.is_active })
  editando.value = s.id
  errorForm.value = ''
  mostrarForm.value = true
}

async function guardar() {
  errorForm.value = ''
  guardando.value = true
  try {
    if (editando.value) await actualizar(editando.value, { ...form })
    else await crear({ ...form })
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
      <button v-if="esAdminOrg && !mostrarForm" @click="nueva">+ Nueva sucursal</button>
    </div>

    <form v-if="mostrarForm" class="panel" @submit.prevent="guardar">
      <h2>{{ editando ? 'Editar sucursal' : 'Nueva sucursal' }}</h2>
      <div class="grilla-form">
        <label>Nombre <input v-model="form.name" required maxlength="120" /></label>
        <label>Teléfono <input v-model="form.phone" type="tel" /></label>
        <label>Email <input v-model="form.email" type="email" /></label>
        <label class="ancho-completo">Dirección <input v-model="form.address" /></label>
        <label class="check"><input v-model="form.is_active" type="checkbox" /> Activa</label>
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
      <p v-else-if="!sucursales.length" class="vacio">
        {{ esAdminOrg ? 'Aún no hay sucursales. Crea la primera.' : 'No tienes sucursales asignadas.' }}
      </p>
      <table v-else class="tabla">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Dirección</th>
            <th>Contacto</th>
            <th>Estado</th>
            <th v-if="esAdminOrg"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in sucursales" :key="s.id">
            <td><strong>{{ s.name }}</strong></td>
            <td>{{ s.address || '—' }}</td>
            <td>
              <div>{{ s.phone || '' }}</div>
              <small class="suave">{{ s.email || '' }}</small>
            </td>
            <td>
              <span class="chip" :class="{ gris: !s.is_active }">{{ s.is_active ? 'Activa' : 'Inactiva' }}</span>
            </td>
            <td v-if="esAdminOrg">
              <div class="acciones">
                <button class="secundario pequeno" @click="editar(s)">Editar</button>
                <button class="secundario pequeno" @click="cambiarEstado(s)">
                  {{ s.is_active ? 'Desactivar' : 'Activar' }}
                </button>
                <button class="peligro pequeno" @click="borrar(s)">Eliminar</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>
