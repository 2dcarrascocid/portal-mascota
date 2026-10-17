<script setup>
import { onMounted, reactive, ref } from 'vue'
import MascotaCampos from '../components/MascotaCampos.vue'
import { useAuth } from '../composables/useAuth'
import { useClients } from '../composables/useClients'
import { useSpecies } from '../composables/useSpecies'
import { mensajeError } from '../services/api'

const { puede } = useAuth()
const {
  tutores,
  cargando,
  error,
  buscar,
  crearConMascotas,
  actualizar,
  eliminar,
  agregarMascota,
  actualizarMascota,
  eliminarMascota,
} = useClients()
const { especies, cargar: cargarEspecies } = useSpecies()

const busqueda = ref('')
let temporizador
function alBuscar() {
  clearTimeout(temporizador)
  temporizador = setTimeout(() => buscar(busqueda.value.trim()), 300)
}

onMounted(() => Promise.all([buscar(), cargarEspecies()]))

const nombreEspecie = (id) => especies.value.find((e) => e.id === id)?.name ?? ''
const nombreRaza = (especieId, razaId) =>
  especies.value.find((e) => e.id === especieId)?.razas.find((r) => r.id === razaId)?.name ?? ''

function edad(fecha) {
  if (!fecha) return ''
  const meses = Math.floor((Date.now() - new Date(fecha)) / (30.44 * 86_400_000))
  return meses < 12 ? `${meses} meses` : `${Math.floor(meses / 12)} años`
}

// ── Formularios ──────────────────────────────────────────────
const tutorVacio = () => ({ national_id: '', first_name: '', last_name: '', phone: '', email: '', address: '' })
const mascotaVacia = () => ({
  name: '',
  species_id: especies.value[0]?.id ?? '',
  breed_id: '',
  birth_date: '',
  weight: '',
  microchip_number: '',
  notes: '',
})

// modo: null | 'nuevo' (tutor + mascotas) | 'tutor' (editar tutor) | 'mascota' (agregar/editar mascota)
const modo = ref(null)
const tutorForm = reactive(tutorVacio())
const mascotasForm = ref([])
const mascotaForm = ref(mascotaVacia())
const tutorActual = ref(null)
const mascotaActual = ref(null)
const errorForm = ref('')
const guardando = ref(false)

function abrir(nuevoModo, { tutor = null, mascota = null } = {}) {
  modo.value = nuevoModo
  tutorActual.value = tutor
  mascotaActual.value = mascota
  errorForm.value = ''
  const campos = tutorVacio()
  for (const k of Object.keys(campos)) tutorForm[k] = tutor?.[k] ?? campos[k]
  mascotasForm.value = nuevoModo === 'nuevo' ? [mascotaVacia()] : []
  mascotaForm.value = mascota ? sinNulos(mascota) : mascotaVacia()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

const sinNulos = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v ?? '']))

async function guardar() {
  errorForm.value = ''
  guardando.value = true
  try {
    if (modo.value === 'nuevo') await crearConMascotas({ ...tutorForm }, mascotasForm.value)
    else if (modo.value === 'tutor') await actualizar(tutorActual.value.id, { ...tutorForm })
    else if (mascotaActual.value) await actualizarMascota(tutorActual.value.id, mascotaActual.value.id, mascotaForm.value)
    else await agregarMascota(tutorActual.value.id, mascotaForm.value)
    modo.value = null
  } catch (err) {
    errorForm.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}

async function borrarTutor(t) {
  if (!confirm(`¿Eliminar a ${t.first_name} ${t.last_name} y sus ${t.pets.length} mascota(s)?`)) return
  try {
    await eliminar(t.id)
  } catch (err) {
    error.value = mensajeError(err)
  }
}

async function borrarMascota(t, m) {
  if (!confirm(`¿Eliminar a ${m.name}?`)) return
  try {
    await eliminarMascota(t.id, m.id)
  } catch (err) {
    error.value = mensajeError(err)
  }
}

const titulos = {
  nuevo: 'Registrar tutor y mascotas',
  tutor: 'Editar tutor',
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Tutores y mascotas</h1>
      <button v-if="!modo && puede('tutores.crear')" @click="abrir('nuevo')">+ Registrar tutor y mascota</button>
    </div>

    <!-- Formulario (registro unificado, edición de tutor o de mascota) -->
    <form v-if="modo" class="panel pagina" @submit.prevent="guardar">
      <h2 style="margin: 0">
        {{
          titulos[modo] ||
          (mascotaActual ? `Editar a ${mascotaActual.name}` : `Nueva mascota de ${tutorActual.first_name}`)
        }}
      </h2>

      <fieldset v-if="modo !== 'mascota'" class="grupo">
        <legend>Tutor</legend>
        <div class="grilla-form">
          <label>Nombre <input v-model="tutorForm.first_name" required maxlength="80" autocomplete="given-name" /></label>
          <label>Apellido <input v-model="tutorForm.last_name" required maxlength="80" autocomplete="family-name" /></label>
          <label>RUT / documento <input v-model="tutorForm.national_id" maxlength="20" placeholder="12.345.678-9" /></label>
          <label>Teléfono <input v-model="tutorForm.phone" type="tel" autocomplete="tel" /></label>
          <label>Email <input v-model="tutorForm.email" type="email" autocomplete="email" /></label>
          <label>Dirección <input v-model="tutorForm.address" autocomplete="street-address" /></label>
        </div>
      </fieldset>

      <template v-if="modo === 'nuevo'">
        <fieldset v-for="(m, i) in mascotasForm" :key="i" class="grupo">
          <legend>Mascota {{ mascotasForm.length > 1 ? i + 1 : '' }}</legend>
          <MascotaCampos v-model="mascotasForm[i]" />
          <button
            v-if="mascotasForm.length > 1"
            type="button"
            class="peligro pequeno"
            style="margin-top: 8px"
            @click="mascotasForm.splice(i, 1)"
          >
            Quitar mascota
          </button>
        </fieldset>
        <div>
          <button type="button" class="secundario pequeno" @click="mascotasForm.push(mascotaVacia())">
            + Otra mascota
          </button>
        </div>
      </template>

      <fieldset v-if="modo === 'mascota'" class="grupo">
        <legend>Mascota</legend>
        <MascotaCampos v-model="mascotaForm" />
      </fieldset>

      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
        <button type="button" class="secundario" @click="modo = null">Cancelar</button>
      </div>
    </form>

    <div class="filtros">
      <label style="flex: 1; min-width: 220px">
        Buscar tutor
        <input
          v-model="busqueda"
          type="search"
          placeholder="Nombre, apellido, RUT o email"
          @input="alBuscar"
        />
      </label>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="cargando" class="vacio">Buscando…</p>
    <p v-else-if="!tutores.length" class="panel vacio">
      {{ busqueda ? 'Sin resultados.' : 'Aún no hay tutores registrados.' }}
    </p>

    <section v-for="t in tutores" :key="t.id" class="panel">
      <div class="pagina-cabecera">
        <div>
          <h3 style="margin: 0">{{ t.first_name }} {{ t.last_name }}</h3>
          <small class="suave">
            {{ [t.national_id, t.phone, t.email].filter(Boolean).join(' · ') || 'Sin datos de contacto' }}
          </small>
        </div>
        <div class="acciones">
          <button v-if="puede('tutores.editar')" class="secundario pequeno" @click="abrir('mascota', { tutor: t })">+ Mascota</button>
          <button v-if="puede('tutores.editar')" class="secundario pequeno" @click="abrir('tutor', { tutor: t })">Editar</button>
          <button v-if="puede('tutores.eliminar')" class="peligro pequeno" @click="borrarTutor(t)">Eliminar</button>
        </div>
      </div>

      <div v-if="t.pets.length" class="tabla-contenedor" style="margin-top: 8px">
        <table class="tabla">
          <tbody>
            <tr v-for="m in t.pets" :key="m.id">
              <td><strong>{{ m.name }}</strong></td>
              <td>
                {{ nombreEspecie(m.species_id) }}
                <small v-if="m.breed_id" class="suave">· {{ nombreRaza(m.species_id, m.breed_id) }}</small>
              </td>
              <td>
                <small class="suave">{{ [edad(m.birth_date), m.weight ? `${m.weight} kg` : ''].filter(Boolean).join(' · ') }}</small>
              </td>
              <td><small v-if="m.microchip_number" class="suave">Chip {{ m.microchip_number }}</small></td>
              <td>
                <div class="acciones">
                  <button v-if="puede('tutores.editar')" class="secundario pequeno" @click="abrir('mascota', { tutor: t, mascota: m })">Editar</button>
                  <button v-if="puede('tutores.eliminar')" class="peligro pequeno" @click="borrarMascota(t, m)">Eliminar</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="suave" style="margin: 8px 0 0">Sin mascotas registradas.</p>
    </section>
  </main>
</template>

<style scoped>
.grupo {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 16px 16px;
  margin: 0;
}
.grupo legend {
  padding: 0 6px;
  font-weight: 600;
  color: var(--text-h);
}
</style>
