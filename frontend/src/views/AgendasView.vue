<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useBranches } from '../composables/useBranches'
import { useSchedules } from '../composables/useSchedules'
import { useStaff } from '../composables/useStaff'
import { DIAS, ORDEN_DIAS, ROLES, ROLES_PERSONAL } from '../lib/catalogos'
import { mensajeError } from '../services/api'

const { esAdminOrg } = useAuth()
const { items: agendas, cargando, error, cargar, crear, actualizar, eliminar } = useSchedules()
const { items: sucursales, cargar: cargarSucursales } = useBranches()
const { personal, cargar: cargarPersonal } = useStaff()

const filtroSucursal = ref('')
const filtroProfesional = ref('')

onMounted(() => Promise.all([cargarSucursales(), cargarPersonal(), recargar()]))
watch([filtroSucursal, filtroProfesional], () => recargar())

function recargar() {
  return cargar({
    ...(filtroSucursal.value && { branchId: filtroSucursal.value }),
    ...(filtroProfesional.value && { staffId: filtroProfesional.value }),
  })
}

const profesionales = computed(() => personal.value.filter((p) => p.activo && ROLES_PERSONAL.includes(p.role)))
const nombre = (id) => {
  const p = personal.value.find((x) => x.id === id)
  return p?.full_name || p?.email || 'Profesional'
}
const sucursal = (id) => sucursales.value.find((s) => s.id === id)?.name ?? 'Sucursal'
const hhmm = (t) => t?.slice(0, 5)

const porDia = computed(() =>
  ORDEN_DIAS.map((dia) => ({ dia, bloques: agendas.value.filter((a) => a.day_of_week === dia) })).filter(
    (d) => d.bloques.length
  )
)

// ── Formulario ───────────────────────────────────────────────
const vacio = () => ({
  branch_id: filtroSucursal.value || '',
  staff_id: filtroProfesional.value || '',
  dias: [1, 2, 3, 4, 5],
  start_time: '09:00',
  end_time: '13:00',
  slot_duration_minutes: 30,
  is_active: true,
})
const form = reactive(vacio())
const editando = ref(null)
const mostrarForm = ref(false)
const errorForm = ref('')
const guardando = ref(false)

// Solo profesionales asignados a la sucursal elegida.
const profesionalesDeSucursal = computed(() =>
  profesionales.value.filter((p) => !form.branch_id || p.branch_ids.includes(form.branch_id))
)

function nuevo() {
  Object.assign(form, vacio())
  editando.value = null
  errorForm.value = ''
  mostrarForm.value = true
}

function editar(a) {
  Object.assign(form, {
    branch_id: a.branch_id,
    staff_id: a.staff_id,
    dias: [a.day_of_week],
    start_time: hhmm(a.start_time),
    end_time: hhmm(a.end_time),
    slot_duration_minutes: a.slot_duration_minutes,
    is_active: a.is_active,
  })
  editando.value = a.id
  errorForm.value = ''
  mostrarForm.value = true
}

async function guardar() {
  errorForm.value = ''
  if (!form.dias.length) {
    errorForm.value = 'Elige al menos un día'
    return
  }
  const { dias, ...bloque } = form
  guardando.value = true
  try {
    if (editando.value) {
      await actualizar(editando.value, { ...bloque, day_of_week: dias[0] })
    } else {
      // Un bloque por día; si alguno choca, se informa cuál y quedan
      // marcados solo los días que faltan (los creados ya se desmarcan).
      for (const dia of dias) {
        try {
          await crear({ ...bloque, day_of_week: dia })
          form.dias = form.dias.filter((d) => d !== dia)
        } catch (err) {
          throw new Error(`${DIAS[dia]}: ${mensajeError(err)}`)
        }
      }
    }
    mostrarForm.value = false
  } catch (err) {
    errorForm.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}

async function borrar(a) {
  if (!confirm(`¿Eliminar el bloque del ${DIAS[a.day_of_week]} ${hhmm(a.start_time)}–${hhmm(a.end_time)}?`)) return
  try {
    await eliminar(a.id)
  } catch (err) {
    error.value = mensajeError(err)
  }
}

const turnos = (a) => {
  const [h1, m1] = a.start_time.split(':').map(Number)
  const [h2, m2] = a.end_time.split(':').map(Number)
  return Math.floor((h2 * 60 + m2 - (h1 * 60 + m1)) / a.slot_duration_minutes)
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Agendas y horarios</h1>
      <button v-if="esAdminOrg && !mostrarForm" @click="nuevo">+ Nuevo horario</button>
    </div>

    <div class="filtros">
      <label>
        Sucursal
        <select v-model="filtroSucursal">
          <option value="">Todas</option>
          <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label>
        Profesional
        <select v-model="filtroProfesional">
          <option value="">Todos</option>
          <option v-for="p in profesionales" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
        </select>
      </label>
    </div>

    <form v-if="mostrarForm" class="panel" @submit.prevent="guardar">
      <h2>{{ editando ? 'Editar horario' : 'Nuevo horario' }}</h2>
      <div class="grilla-form">
        <label>
          Sucursal
          <select v-model="form.branch_id" required>
            <option value="" disabled>Elegir…</option>
            <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label>
          Profesional
          <select v-model="form.staff_id" required>
            <option value="" disabled>Elegir…</option>
            <option v-for="p in profesionalesDeSucursal" :key="p.id" :value="p.id">
              {{ p.full_name || p.email }} · {{ ROLES[p.role] }}
            </option>
          </select>
          <small v-if="form.branch_id && !profesionalesDeSucursal.length" class="suave">
            Nadie está asignado a esta sucursal (ver Personal).
          </small>
        </label>
        <label>Desde <input v-model="form.start_time" type="time" required /></label>
        <label>Hasta <input v-model="form.end_time" type="time" required /></label>
        <label>
          Duración de cada turno (min)
          <input v-model.number="form.slot_duration_minutes" type="number" min="5" max="480" step="5" required />
        </label>
        <div class="campo ancho-completo">
          {{ editando ? 'Día' : 'Días' }}
          <div class="chips">
            <label v-for="dia in ORDEN_DIAS" :key="dia" class="check">
              <input
                v-if="editando"
                v-model="form.dias[0]"
                type="radio"
                name="dia"
                :value="dia"
              />
              <input v-else v-model="form.dias" type="checkbox" :value="dia" />
              {{ DIAS[dia] }}
            </label>
          </div>
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

    <p v-if="cargando" class="vacio">Cargando…</p>
    <p v-else-if="!porDia.length" class="panel vacio">No hay horarios configurados con estos filtros.</p>

    <section v-for="d in porDia" :key="d.dia" class="panel">
      <h3>{{ DIAS[d.dia] }}</h3>
      <div class="tabla-contenedor">
        <table class="tabla">
          <tbody>
            <tr v-for="a in d.bloques" :key="a.id" :style="{ opacity: a.is_active ? 1 : 0.55 }">
              <td><strong>{{ hhmm(a.start_time) }} – {{ hhmm(a.end_time) }}</strong></td>
              <td>{{ nombre(a.staff_id) }}</td>
              <td>{{ sucursal(a.branch_id) }}</td>
              <td>
                <small class="suave">{{ turnos(a) }} turnos de {{ a.slot_duration_minutes }} min</small>
                <span v-if="!a.is_active" class="chip gris">Inactivo</span>
              </td>
              <td v-if="esAdminOrg">
                <div class="acciones">
                  <button class="secundario pequeno" @click="editar(a)">Editar</button>
                  <button class="peligro pequeno" @click="borrar(a)">Eliminar</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>
