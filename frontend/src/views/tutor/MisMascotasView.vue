<script setup>
import { onMounted, ref } from 'vue'
import MascotaCampos from '../../components/MascotaCampos.vue'
import { confirmar } from '../../composables/useDialogo'
import { usePortal } from '../../composables/usePortal'
import { useSpecies } from '../../composables/useSpecies'
import { mensajeError } from '../../services/api'

const { mascotas, cargarMascotas, crearMascota, actualizarMascota, eliminarMascota } = usePortal()
const { especies, cargar: cargarEspecies } = useSpecies()

const cargando = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    await Promise.all([cargarMascotas(), cargarEspecies('/portal/especies')])
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
})

const nombreEspecie = (id) => especies.value.find((e) => e.id === id)?.name ?? ''
const nombreRaza = (especieId, razaId) =>
  especies.value.find((e) => e.id === especieId)?.razas.find((r) => r.id === razaId)?.name ?? ''

function edad(fecha) {
  if (!fecha) return ''
  const meses = Math.floor((Date.now() - new Date(fecha)) / (30.44 * 86_400_000))
  if (meses < 1) return 'menos de 1 mes'
  return meses < 12 ? `${meses} ${meses === 1 ? 'mes' : 'meses'}` : `${Math.floor(meses / 12)} años`
}

const vacia = () => ({
  name: '',
  species_id: especies.value[0]?.id ?? '',
  breed_id: '',
  birth_date: '',
  weight: '',
  microchip_number: '',
  notes: '',
})

// editando: null (cerrado) | 'nueva' | id de la mascota
const editando = ref(null)
const form = ref(vacia())
const guardando = ref(false)
const errorForm = ref('')

function nueva() {
  form.value = vacia()
  editando.value = 'nueva'
  errorForm.value = ''
}

function editar(m) {
  form.value = {
    name: m.name,
    species_id: m.species_id,
    breed_id: m.breed_id ?? '',
    birth_date: m.birth_date ?? '',
    weight: m.weight ?? '',
    microchip_number: m.microchip_number ?? '',
    notes: m.notes ?? '',
  }
  editando.value = m.id
  errorForm.value = ''
}

async function guardar() {
  errorForm.value = ''
  guardando.value = true
  try {
    if (editando.value === 'nueva') await crearMascota(form.value)
    else await actualizarMascota(editando.value, form.value)
    editando.value = null
  } catch (err) {
    errorForm.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}

async function quitar(m) {
  const ok = await confirmar({
    titulo: `¿Eliminar a ${m.name}?`,
    mensaje: 'Se quita de tu cuenta. Las atenciones que ya tuvo en las sucursales se conservan en sus registros.',
    aceptar: 'Eliminar',
    peligro: true,
  })
  if (!ok) return
  try {
    await eliminarMascota(m.id)
  } catch (err) {
    error.value = mensajeError(err)
  }
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Mis mascotas</h1>
      <button v-if="!editando" :disabled="cargando" @click="nueva">+ Agregar mascota</button>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <form v-if="editando" class="panel" @submit.prevent="guardar">
      <h2>{{ editando === 'nueva' ? 'Nueva mascota' : `Editar a ${form.name}` }}</h2>
      <MascotaCampos v-model="form" />
      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
        <button type="button" class="secundario" @click="editando = null">Cancelar</button>
      </div>
    </form>

    <p v-if="cargando" class="suave">Cargando…</p>
    <p v-else-if="!mascotas.length && !editando" class="panel vacio">
      Aún no registras mascotas. Agrega la primera para poder reservar horas.
    </p>

    <div v-else class="tarjetas">
      <article v-for="m in mascotas" :key="m.id" class="panel mascota">
        <header>
          <h3>{{ m.name }}</h3>
          <span class="chip gris">{{ nombreEspecie(m.species_id) }}</span>
        </header>
        <dl>
          <template v-if="m.breed_id">
            <dt>Raza</dt>
            <dd>{{ nombreRaza(m.species_id, m.breed_id) }}</dd>
          </template>
          <template v-if="m.birth_date">
            <dt>Edad</dt>
            <dd>{{ edad(m.birth_date) }}</dd>
          </template>
          <template v-if="m.weight">
            <dt>Peso</dt>
            <dd>{{ m.weight }} kg</dd>
          </template>
          <template v-if="m.microchip_number">
            <dt>Microchip</dt>
            <dd>{{ m.microchip_number }}</dd>
          </template>
        </dl>
        <p v-if="m.notes" class="suave notas">{{ m.notes }}</p>
        <div class="acciones">
          <RouterLink :to="{ name: 'mi-reservar', query: { mascota: m.id } }">Reservar hora</RouterLink>
          <RouterLink :to="{ name: 'mi-historial', query: { mascota: m.id } }">Historial</RouterLink>
          <span class="espacio"></span>
          <button class="secundario pequeno" @click="editar(m)">Editar</button>
          <button class="peligro pequeno" @click="quitar(m)">Eliminar</button>
        </div>
      </article>
    </div>
  </main>
</template>

<style scoped>
.tarjetas {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.mascota {
  display: grid;
  gap: 8px;
  align-content: start;
}
.mascota header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.mascota h3 {
  margin: 0;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 0;
  font-size: 0.9rem;
}
dt {
  color: var(--text-suave);
}
dd {
  margin: 0;
}
.notas {
  margin: 0;
  font-size: 0.85rem;
}
.espacio {
  flex: 1;
}
.acciones a {
  font-size: 0.9rem;
}
</style>
