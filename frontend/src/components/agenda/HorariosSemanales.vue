<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useSchedules } from '../../composables/useSchedules'
import { DIAS, ORDEN_DIAS, ROLES } from '../../lib/catalogos'
import { fechaCorta, hhmm } from '../../lib/fechas'
import { mensajeError } from '../../services/api'

// 5.1 Bloques de horario: días y horas de cada semana, con vigencia
// opcional por fechas (p. ej. horario de verano de diciembre a febrero).
const props = defineProps({
  sucursales: { type: Array, required: true },
  profesionales: { type: Array, required: true },
  filtroSucursal: { type: String, default: '' },
  filtroProfesional: { type: String, default: '' },
})

const { puede } = useAuth()
const { items: agendas, cargando, error, cargar, crear, actualizar, eliminar, copiar } = useSchedules()

onMounted(recargar)
watch(() => [props.filtroSucursal, props.filtroProfesional], recargar)

function recargar() {
  return cargar({
    ...(props.filtroSucursal && { branchId: props.filtroSucursal }),
    ...(props.filtroProfesional && { staffId: props.filtroProfesional }),
  })
}

const nombre = (id) => {
  const p = props.profesionales.find((x) => x.id === id)
  return p?.full_name || p?.email || 'Profesional'
}
const sucursal = (id) => props.sucursales.find((s) => s.id === id)?.name ?? 'Sucursal'

const porDia = computed(() =>
  ORDEN_DIAS.map((dia) => ({ dia, bloques: agendas.value.filter((a) => a.day_of_week === dia) })).filter(
    (d) => d.bloques.length
  )
)

function vigencia(a) {
  if (a.valid_from && a.valid_to) return `${fechaCorta(a.valid_from, { dia: false })} al ${fechaCorta(a.valid_to, { anio: true, dia: false })}`
  if (a.valid_from) return `desde ${fechaCorta(a.valid_from, { anio: true, dia: false })}`
  if (a.valid_to) return `hasta ${fechaCorta(a.valid_to, { anio: true, dia: false })}`
  return ''
}

const turnos = (a) => {
  const [h1, m1] = a.start_time.split(':').map(Number)
  const [h2, m2] = a.end_time.split(':').map(Number)
  return Math.floor((h2 * 60 + m2 - (h1 * 60 + m1)) / a.slot_duration_minutes)
}

// ── Formulario ───────────────────────────────────────────────
// panel: null | 'bloque' | 'copiar'
const panel = ref(null)
const vacio = () => ({
  branch_id: props.filtroSucursal || '',
  staff_id: props.filtroProfesional || '',
  dias: [1, 2, 3, 4, 5],
  start_time: '09:00',
  end_time: '13:00',
  slot_duration_minutes: 30,
  valid_from: '',
  valid_to: '',
  is_active: true,
})
const form = reactive(vacio())
const editando = ref(null)
const errorForm = ref('')
const guardando = ref(false)

// Solo profesionales asignados a la sucursal elegida.
const deSucursal = (branchId) => props.profesionales.filter((p) => !branchId || p.branch_ids.includes(branchId))
const profesionalesDeSucursal = computed(() => deSucursal(form.branch_id))

function nuevo() {
  Object.assign(form, vacio())
  editando.value = null
  errorForm.value = ''
  panel.value = 'bloque'
}

function editar(a) {
  Object.assign(form, {
    branch_id: a.branch_id,
    staff_id: a.staff_id,
    dias: [a.day_of_week],
    start_time: hhmm(a.start_time),
    end_time: hhmm(a.end_time),
    slot_duration_minutes: a.slot_duration_minutes,
    valid_from: a.valid_from ?? '',
    valid_to: a.valid_to ?? '',
    is_active: a.is_active,
  })
  editando.value = a.id
  errorForm.value = ''
  panel.value = 'bloque'
}

async function guardar() {
  errorForm.value = ''
  if (!form.dias.length) {
    errorForm.value = 'Elige al menos un día'
    return
  }
  const { dias, ...resto } = form
  const bloque = { ...resto, valid_from: resto.valid_from || null, valid_to: resto.valid_to || null }
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
    panel.value = null
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

// ── Copiar horario entre profesionales ───────────────────────
const copia = reactive({ branch_id: '', from_staff_id: '', to_staff_id: '', valid_from: '', valid_to: '' })
const aviso = ref('')

function abrirCopia() {
  Object.assign(copia, {
    branch_id: props.filtroSucursal || '',
    from_staff_id: props.filtroProfesional || '',
    to_staff_id: '',
    valid_from: '',
    valid_to: '',
  })
  errorForm.value = ''
  panel.value = 'copiar'
}

async function guardarCopia() {
  errorForm.value = ''
  guardando.value = true
  try {
    const creados = await copiar({ ...copia, valid_from: copia.valid_from || null, valid_to: copia.valid_to || null })
    aviso.value = `Se copiaron ${creados.length} bloque(s) a ${nombre(copia.to_staff_id)}.`
    panel.value = null
    await recargar() // la lista respeta los filtros activos
  } catch (err) {
    errorForm.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="pagina">
    <div v-if="!panel && puede('agendas.crear')" class="acciones">
      <button @click="nuevo">+ Nuevo horario</button>
      <button class="secundario" @click="abrirCopia">Copiar horario de un profesional</button>
    </div>

    <form v-if="panel === 'bloque'" class="panel" @submit.prevent="guardar">
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
              <input v-if="editando" v-model="form.dias[0]" type="radio" name="dia" :value="dia" />
              <input v-else v-model="form.dias" type="checkbox" :value="dia" />
              {{ DIAS[dia] }}
            </label>
          </div>
        </div>
        <label>
          Vigente desde
          <input v-model="form.valid_from" type="date" />
          <small class="suave">Vacío = desde ya</small>
        </label>
        <label>
          Vigente hasta
          <input v-model="form.valid_to" type="date" :min="form.valid_from || undefined" />
          <small class="suave">Vacío = sin término</small>
        </label>
        <label class="check"><input v-model="form.is_active" type="checkbox" /> Activo</label>
      </div>
      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
        <button type="button" class="secundario" @click="panel = null">Cancelar</button>
      </div>
    </form>

    <form v-if="panel === 'copiar'" class="panel" @submit.prevent="guardarCopia">
      <h2>Copiar horario</h2>
      <p class="suave" style="margin-top: 0">
        Copia todos los bloques semanales de un profesional en una sucursal a otro profesional asignado a ella. Si
        alguno se cruza con su horario actual, no se copia ninguno.
      </p>
      <div class="grilla-form">
        <label>
          Sucursal
          <select v-model="copia.branch_id" required>
            <option value="" disabled>Elegir…</option>
            <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label>
          Copiar desde
          <select v-model="copia.from_staff_id" required>
            <option value="" disabled>Elegir…</option>
            <option v-for="p in deSucursal(copia.branch_id)" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
          </select>
        </label>
        <label>
          Hacia
          <select v-model="copia.to_staff_id" required>
            <option value="" disabled>Elegir…</option>
            <option
              v-for="p in deSucursal(copia.branch_id).filter((x) => x.id !== copia.from_staff_id)"
              :key="p.id"
              :value="p.id"
            >
              {{ p.full_name || p.email }}
            </option>
          </select>
        </label>
        <label>
          Nueva vigencia desde
          <input v-model="copia.valid_from" type="date" />
        </label>
        <label>
          Nueva vigencia hasta
          <input v-model="copia.valid_to" type="date" :min="copia.valid_from || undefined" />
          <small class="suave">Vacías = se conserva la de cada bloque</small>
        </label>
      </div>
      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Copiando…' : 'Copiar' }}</button>
        <button type="button" class="secundario" @click="panel = null">Cancelar</button>
      </div>
    </form>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="aviso" class="suave" role="status">{{ aviso }}</p>

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
                <span v-if="vigencia(a)" class="chip gris">{{ vigencia(a) }}</span>
                <span v-if="!a.is_active" class="chip gris">Inactivo</span>
              </td>
              <td v-if="puede('agendas.editar') || puede('agendas.eliminar')">
                <div class="acciones">
                  <button v-if="puede('agendas.editar')" class="secundario pequeno" @click="editar(a)">Editar</button>
                  <button v-if="puede('agendas.eliminar')" class="peligro pequeno" @click="borrar(a)">Eliminar</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
