<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useScheduleExceptions } from '../../composables/useSchedules'
import { conEspecialidad } from '../../composables/useStaff'
import { TIPOS_EXCEPCION } from '../../lib/catalogos'
import { hhmm, hoy, rangoFechas, sumarDias } from '../../lib/fechas'
import { mensajeError } from '../../services/api'
import { confirmar } from '../../composables/useDialogo'

// 5.2 Excepciones de atención y 5.3 funciones especiales de mantención:
//   BLOQUEO         no se atiende (feriado, vacaciones, licencia, reunión...)
//   HORARIO_EXTRA   atención adicional en fechas puntuales
//   CAMBIO_HORARIO  en esas fechas reemplaza el horario semanal
//   Mover un día    bloqueo del día original + horario extra en el nuevo
const props = defineProps({
  sucursales: { type: Array, required: true },
  profesionales: { type: Array, required: true },
  filtroSucursal: { type: String, default: '' },
  filtroEspecialidad: { type: String, default: '' },
  filtroProfesional: { type: String, default: '' },
})

const { esAdminOrg, puede } = useAuth()
const { items: excepciones, cargando, error, cargar, crear, actualizar, eliminar, moverDia } = useScheduleExceptions()

const AYUDA = {
  BLOQUEO: 'No se atiende en esas fechas. Puede ser de un profesional, de una sucursal o de toda la entidad.',
  HORARIO_EXTRA: 'Atención adicional al horario semanal, en fechas puntuales.',
  CAMBIO_HORARIO: 'En esas fechas, reemplaza el horario semanal del profesional en la sucursal.',
}

const desde = ref(hoy())
const hasta = ref(sumarDias(hoy(), 90))

onMounted(recargar)
watch(() => [props.filtroSucursal, props.filtroProfesional, desde.value, hasta.value], recargar)

function recargar() {
  return cargar({
    ...(desde.value && { desde: desde.value }),
    ...(hasta.value && { hasta: hasta.value }),
    ...(props.filtroSucursal && { branchId: props.filtroSucursal }),
    ...(props.filtroProfesional && { staffId: props.filtroProfesional }),
  })
}

// Con especialidad: las de profesionales que la tienen (y las de todos).
const ordenadas = computed(() =>
  excepciones.value.filter((e) => conEspecialidad(props.profesionales, e.staff_id, props.filtroEspecialidad)).sort(
    (a, b) => a.start_date.localeCompare(b.start_date) || (a.start_time ?? '').localeCompare(b.start_time ?? '')
  )
)

const nombre = (id) => {
  const p = props.profesionales.find((x) => x.id === id)
  return p?.full_name || p?.email || 'Profesional'
}
const sucursal = (id) => props.sucursales.find((s) => s.id === id)?.name ?? 'Sucursal'

function alcance(e) {
  if (e.staff_id && e.branch_id) return `${nombre(e.staff_id)} · ${sucursal(e.branch_id)}`
  if (e.staff_id) return `${nombre(e.staff_id)} · todas sus sucursales`
  if (e.branch_id) return `Toda la sucursal ${sucursal(e.branch_id)}`
  return 'Toda la entidad'
}

const horario = (e) =>
  e.start_time
    ? `${hhmm(e.start_time)} – ${hhmm(e.end_time)}${e.slot_duration_minutes ? ` · turnos de ${e.slot_duration_minutes} min` : ''}`
    : 'Día completo'

// ── Formulario ───────────────────────────────────────────────
// panel: null | 'excepcion' | 'mover'
const panel = ref(null)
const vacio = (type = 'BLOQUEO') => ({
  type,
  staff_id: props.filtroProfesional || '',
  branch_id: props.filtroSucursal || '',
  start_date: hoy(),
  end_date: hoy(),
  dia_completo: type === 'BLOQUEO',
  start_time: '09:00',
  end_time: '13:00',
  slot_duration_minutes: 30,
  reason: '',
})
const form = reactive(vacio())
const editando = ref(null)
const errorForm = ref('')
const guardando = ref(false)
const aviso = ref('')

const esBloqueo = computed(() => form.type === 'BLOQUEO')
const profesionalesDeSucursal = computed(() =>
  props.profesionales.filter((p) => !form.branch_id || p.branch_ids.includes(form.branch_id))
)
// Quien no es admin trabaja solo sobre sus sucursales (sin alcance "todas").
const permiteTodasSucursales = computed(() => esBloqueo.value && esAdminOrg.value)

watch(
  () => form.type,
  (tipo) => {
    if (tipo !== 'BLOQUEO') form.dia_completo = false
  }
)
watch(
  () => form.start_date,
  (d) => {
    if (form.end_date < d) form.end_date = d
  }
)

function nueva(type) {
  Object.assign(form, vacio(type))
  editando.value = null
  errorForm.value = ''
  panel.value = 'excepcion'
}

function editar(e) {
  Object.assign(form, {
    type: e.type,
    staff_id: e.staff_id ?? '',
    branch_id: e.branch_id ?? '',
    start_date: e.start_date,
    end_date: e.end_date,
    dia_completo: !e.start_time,
    start_time: hhmm(e.start_time) || '09:00',
    end_time: hhmm(e.end_time) || '13:00',
    slot_duration_minutes: e.slot_duration_minutes ?? 30,
    reason: e.reason ?? '',
  })
  editando.value = e.id
  errorForm.value = ''
  panel.value = 'excepcion'
}

async function guardar() {
  errorForm.value = ''
  const { dia_completo, ...e } = form
  const datos = {
    ...e,
    staff_id: e.staff_id || null,
    branch_id: e.branch_id || null,
    start_time: dia_completo ? null : e.start_time,
    end_time: dia_completo ? null : e.end_time,
    slot_duration_minutes: esBloqueo.value ? null : e.slot_duration_minutes,
  }
  guardando.value = true
  try {
    if (editando.value) await actualizar(editando.value, datos)
    else await crear(datos)
    panel.value = null
  } catch (err) {
    errorForm.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}

async function borrar(e) {
  const mensaje = `¿Eliminar ${TIPOS_EXCEPCION[e.type].toLowerCase()} del ${rangoFechas(e.start_date, e.end_date)}?`
  if (!(await confirmar({ titulo: 'Eliminar excepción', mensaje: mensaje, aceptar: 'Eliminar', peligro: true }))) return
  try {
    await eliminar(e.id)
  } catch (err) {
    error.value = mensajeError(err)
  }
}

// ── Mover un día ─────────────────────────────────────────────
const mover = reactive({ staff_id: '', branch_id: '', desde: '', hacia: '', reason: '' })

function abrirMover() {
  Object.assign(mover, {
    staff_id: props.filtroProfesional || '',
    branch_id: props.filtroSucursal || '',
    desde: hoy(),
    hacia: sumarDias(hoy(), 1),
    reason: '',
  })
  errorForm.value = ''
  panel.value = 'mover'
}

async function guardarMover() {
  errorForm.value = ''
  guardando.value = true
  try {
    await moverDia({ ...mover, branch_id: mover.branch_id || null })
    aviso.value = `Atención de ${nombre(mover.staff_id)} trasladada del ${rangoFechas(mover.desde)} al ${rangoFechas(mover.hacia)}.`
    panel.value = null
    await recargar()
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
      <button @click="nueva('BLOQUEO')">+ Bloqueo</button>
      <button class="secundario" @click="nueva('HORARIO_EXTRA')">+ Horario extra</button>
      <button class="secundario" @click="nueva('CAMBIO_HORARIO')">+ Cambio de horario</button>
      <button class="secundario" @click="abrirMover">Mover un día</button>
    </div>

    <form v-if="panel === 'excepcion'" class="panel" @submit.prevent="guardar">
      <h2>{{ editando ? 'Editar excepción' : 'Nueva excepción' }}</h2>
      <div class="acciones" role="radiogroup" aria-label="Tipo de excepción">
        <label v-for="(etiqueta, valor) in TIPOS_EXCEPCION" :key="valor" class="check">
          <input v-model="form.type" type="radio" name="tipo" :value="valor" />
          {{ etiqueta }}
        </label>
      </div>
      <p class="suave">{{ AYUDA[form.type] }}</p>
      <div class="grilla-form">
        <label>
          Sucursal
          <select v-model="form.branch_id" :required="!permiteTodasSucursales">
            <option v-if="permiteTodasSucursales" value="">Todas</option>
            <option v-else value="" disabled>Elegir…</option>
            <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label>
          Profesional
          <select v-model="form.staff_id" :required="!esBloqueo">
            <option v-if="esBloqueo" value="">Todos</option>
            <option v-else value="" disabled>Elegir…</option>
            <option v-for="p in profesionalesDeSucursal" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
          </select>
        </label>
        <label>Desde <input v-model="form.start_date" type="date" required /></label>
        <label>Hasta <input v-model="form.end_date" type="date" :min="form.start_date" required /></label>
        <label v-if="esBloqueo" class="check ancho-completo">
          <input v-model="form.dia_completo" type="checkbox" /> Día completo
        </label>
        <template v-if="!form.dia_completo">
          <label>Hora inicio <input v-model="form.start_time" type="time" required /></label>
          <label>Hora término <input v-model="form.end_time" type="time" required /></label>
        </template>
        <label v-if="!esBloqueo">
          Duración de cada turno (min)
          <input v-model.number="form.slot_duration_minutes" type="number" min="5" max="480" step="5" required />
        </label>
        <label class="ancho-completo">
          Motivo
          <input v-model="form.reason" maxlength="200" placeholder="Ej: Feriado, vacaciones, operativo de vacunación" />
        </label>
      </div>
      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
        <button type="button" class="secundario" @click="panel = null">Cancelar</button>
      </div>
    </form>

    <form v-if="panel === 'mover'" class="panel" @submit.prevent="guardarMover">
      <h2>Mover un día de atención</h2>
      <p class="suave" style="margin-top: 0">
        Bloquea el día original y crea horarios extra en el día nuevo con los mismos tramos y turnos.
      </p>
      <div class="grilla-form">
        <label>
          Profesional
          <select v-model="mover.staff_id" required>
            <option value="" disabled>Elegir…</option>
            <option v-for="p in profesionales" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
          </select>
        </label>
        <label>
          Sucursal
          <select v-model="mover.branch_id">
            <option value="">Todas en las que atiende ese día</option>
            <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label>Día original <input v-model="mover.desde" type="date" required /></label>
        <label>Día nuevo <input v-model="mover.hacia" type="date" required /></label>
        <label class="ancho-completo">Motivo <input v-model="mover.reason" maxlength="200" /></label>
      </div>
      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Mover' }}</button>
        <button type="button" class="secundario" @click="panel = null">Cancelar</button>
      </div>
    </form>

    <div class="filtros">
      <label>Desde <input v-model="desde" type="date" /></label>
      <label>Hasta <input v-model="hasta" type="date" :min="desde || undefined" /></label>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="aviso" class="suave" role="status">{{ aviso }}</p>

    <section class="panel tabla-contenedor">
      <p v-if="cargando" class="vacio">Cargando…</p>
      <p v-else-if="!ordenadas.length" class="vacio">No hay excepciones en estas fechas.</p>
      <table v-else class="tabla">
        <thead>
          <tr>
            <th>Fechas</th>
            <th>Tipo</th>
            <th>Alcance</th>
            <th>Horario</th>
            <th v-if="puede('agendas.editar') || puede('agendas.eliminar')"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in ordenadas" :key="e.id">
            <td><strong>{{ rangoFechas(e.start_date, e.end_date) }}</strong></td>
            <td>
              <span class="chip" :class="e.type.toLowerCase()">{{ TIPOS_EXCEPCION[e.type] }}</span>
              <div v-if="e.reason"><small class="suave">{{ e.reason }}</small></div>
            </td>
            <td>{{ alcance(e) }}</td>
            <td>{{ horario(e) }}</td>
            <td v-if="puede('agendas.editar') || puede('agendas.eliminar')">
              <div class="acciones">
                <button v-if="puede('agendas.editar')" class="secundario pequeno" @click="editar(e)">Editar</button>
                <button v-if="puede('agendas.eliminar')" class="peligro pequeno" @click="borrar(e)">Eliminar</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.chip.bloqueo {
  background: color-mix(in srgb, var(--peligro) 14%, transparent);
  color: var(--peligro);
}
.chip.horario_extra {
  background: color-mix(in srgb, var(--ok) 15%, transparent);
  color: var(--ok);
}
.chip.cambio_horario {
  background: color-mix(in srgb, var(--aviso) 18%, transparent);
  color: var(--aviso);
}
</style>
