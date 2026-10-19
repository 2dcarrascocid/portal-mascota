<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useSchedules } from '../../composables/useSchedules'
import { conEspecialidad } from '../../composables/useStaff'
import { DIAS, ORDEN_DIAS } from '../../lib/catalogos'
import { fechaCorta, hhmm } from '../../lib/fechas'
import { mensajeError } from '../../services/api'
import { confirmar } from '../../composables/useDialogo'

// 5.1 Bloques de horario: días y horas de cada semana, con vigencia
// opcional por fechas (p. ej. horario de verano de diciembre a febrero).
// Un horario nuevo es para la sucursal y el profesional elegidos en el
// panel izquierdo; con excepción horaria (p. ej. colación) cada día queda
// en dos bloques: antes y después de la excepción.
const props = defineProps({
  sucursales: { type: Array, required: true },
  profesionales: { type: Array, required: true },
  filtroSucursal: { type: String, default: '' },
  filtroEspecialidad: { type: String, default: '' },
  filtroProfesional: { type: String, default: '' },
})

const { puede } = useAuth()
const { items: agendas, cargando, error, cargar, actualizar, eliminar, copiar, crearVarios } = useSchedules()

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

// Con especialidad: solo los bloques de profesionales que la tienen.
const visibles = computed(() =>
  agendas.value.filter((a) => conEspecialidad(props.profesionales, a.staff_id, props.filtroEspecialidad))
)
const porDia = computed(() =>
  ORDEN_DIAS.map((dia) => ({ dia, bloques: visibles.value.filter((a) => a.day_of_week === dia) })).filter(
    (d) => d.bloques.length
  )
)

function vigencia(a) {
  if (a.valid_from && a.valid_to) return `${fechaCorta(a.valid_from, { dia: false })} al ${fechaCorta(a.valid_to, { anio: true, dia: false })}`
  if (a.valid_from) return `desde ${fechaCorta(a.valid_from, { anio: true, dia: false })}`
  if (a.valid_to) return `hasta ${fechaCorta(a.valid_to, { anio: true, dia: false })}`
  return ''
}

const minutos = (t) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const turnosEntre = (inicio, fin, duracion) => Math.floor((minutos(fin) - minutos(inicio)) / duracion)
const turnos = (a) => turnosEntre(a.start_time, a.end_time, a.slot_duration_minutes)

// ── Formulario ───────────────────────────────────────────────
// panel: null | 'bloque' | 'copiar'
const panel = ref(null)
const vacio = () => ({
  branch_id: '',
  staff_id: '',
  dias: [1, 2, 3, 4, 5],
  start_time: '09:00',
  end_time: '18:00',
  slot_duration_minutes: 30,
  pausa_desde: '',
  pausa_hasta: '',
  valid_from: '',
  valid_to: '',
  is_active: true,
})
const form = reactive(vacio())
const editando = ref(null)
const errorForm = ref('')
const guardando = ref(false)

// Para quién es: al editar, el del bloque; nuevo, lo elegido a la izquierda.
const destino = computed(() =>
  editando.value
    ? { branch_id: form.branch_id, staff_id: form.staff_id }
    : { branch_id: props.filtroSucursal, staff_id: props.filtroProfesional }
)
const faltaDestino = computed(() => !destino.value.branch_id || !destino.value.staff_id)

// Tramos de cada día: el horario completo o, con excepción horaria, antes y
// después de ella. { tramos: [[desde, hasta], ...] } o { error }.
const tramos = computed(() => {
  const { start_time: ini, end_time: fin, pausa_desde: pd, pausa_hasta: ph } = form
  if (!ini || !fin) return { tramos: [] }
  if (fin <= ini) return { error: 'La hora de término debe ser posterior a la de inicio.' }
  if (editando.value || (!pd && !ph)) return { tramos: [[ini, fin]] }
  if (!pd || !ph) return { error: 'Indica desde y hasta de la excepción horaria, o deja ambas vacías.' }
  if (!(ini < pd && pd < ph && ph < fin)) return { error: 'La excepción horaria debe quedar dentro del horario.' }
  return { tramos: [[ini, pd], [ph, fin]] }
})
const resumen = computed(() => {
  const lista = tramos.value.tramos
  if (!lista?.length || !form.slot_duration_minutes) return ''
  const n = lista.reduce((s, [a, b]) => s + turnosEntre(a, b, form.slot_duration_minutes), 0)
  const dias = ORDEN_DIAS.filter((d) => form.dias.includes(d)).map((d) => DIAS[d])
  return `${dias.join(', ') || 'Sin días'} · ${lista.map(([a, b]) => `${a}–${b}`).join(' y ')} · ${n} turnos de ${form.slot_duration_minutes} min por día`
})

// Solo profesionales asignados a la sucursal elegida (copia de horarios).
const deSucursal = (branchId) => props.profesionales.filter((p) => !branchId || p.branch_ids.includes(branchId))

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
    pausa_desde: '',
    pausa_hasta: '',
    valid_to: a.valid_to ?? '',
    is_active: a.is_active,
  })
  editando.value = a.id
  errorForm.value = ''
  panel.value = 'bloque'
}

async function guardar() {
  errorForm.value = ''
  if (faltaDestino.value) {
    errorForm.value = 'Elige la sucursal y el profesional en el panel izquierdo.'
    return
  }
  if (!form.dias.length) {
    errorForm.value = 'Elige al menos un día'
    return
  }
  if (tramos.value.error) {
    errorForm.value = tramos.value.error
    return
  }
  const bloque = {
    ...destino.value,
    slot_duration_minutes: form.slot_duration_minutes,
    valid_from: form.valid_from || null,
    valid_to: form.valid_to || null,
    is_active: form.is_active,
  }
  guardando.value = true
  try {
    if (editando.value) {
      const [[start_time, end_time]] = tramos.value.tramos
      await actualizar(editando.value, { ...bloque, day_of_week: form.dias[0], start_time, end_time })
    } else {
      // Todos los días y tramos de una vez: si alguno choca, no se crea ninguno.
      await crearVarios(
        form.dias.flatMap((dia) =>
          tramos.value.tramos.map(([start_time, end_time]) => ({ ...bloque, day_of_week: dia, start_time, end_time }))
        )
      )
    }
    panel.value = null
  } catch (err) {
    errorForm.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}

async function borrar(a) {
  if (!(await confirmar({ titulo: 'Eliminar bloque', mensaje: `¿Eliminar el bloque del ${DIAS[a.day_of_week]} ${hhmm(a.start_time)}–${hhmm(a.end_time)}?`, aceptar: 'Eliminar', peligro: true }))) return
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

    <form v-if="panel === 'bloque'" class="panel horario" @submit.prevent="guardar">
      <h2>{{ editando ? 'Editar horario' : 'Nuevo horario' }}</h2>
      <p v-if="faltaDestino" class="aviso">
        ← Elige la <strong>sucursal</strong>, la especialidad y el <strong>profesional</strong> en el panel izquierdo.
      </p>
      <p v-else class="para">
        Para <strong>{{ nombre(destino.staff_id) }}</strong> · {{ sucursal(destino.branch_id) }}
      </p>

      <fieldset>
        <legend>Fecha</legend>
        <div class="grilla-form">
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
          <label class="check activa"><input v-model="form.is_active" type="checkbox" /> Agenda activa</label>
        </div>
      </fieldset>

      <fieldset>
        <legend>{{ editando ? 'Día de la semana' : 'Días de la semana' }}</legend>
        <div class="chips">
          <label v-for="dia in ORDEN_DIAS" :key="dia" class="check">
            <input v-if="editando" v-model="form.dias[0]" type="radio" name="dia" :value="dia" />
            <input v-else v-model="form.dias" type="checkbox" :value="dia" />
            {{ DIAS[dia] }}
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Horario</legend>
        <div class="grilla-form">
          <label>Desde <input v-model="form.start_time" type="time" required /></label>
          <label>Hasta <input v-model="form.end_time" type="time" required /></label>
          <label>
            Duración de cada turno (min)
            <input v-model.number="form.slot_duration_minutes" type="number" min="5" max="480" step="5" required />
          </label>
        </div>
      </fieldset>

      <fieldset v-if="!editando">
        <legend>Excepción horaria <small class="suave">(opcional, p. ej. colación)</small></legend>
        <div class="grilla-form">
          <label>Desde <input v-model="form.pausa_desde" type="time" :min="form.start_time" :max="form.end_time" /></label>
          <label>Hasta <input v-model="form.pausa_hasta" type="time" :min="form.pausa_desde || form.start_time" :max="form.end_time" /></label>
          <div class="campo al-pie">
            <button
              v-if="form.pausa_desde || form.pausa_hasta"
              type="button"
              class="secundario pequeno"
              @click="Object.assign(form, { pausa_desde: '', pausa_hasta: '' })"
            >
              Sin excepción
            </button>
          </div>
        </div>
      </fieldset>

      <p v-if="tramos.error" class="aviso">{{ tramos.error }}</p>
      <p v-else-if="resumen" class="suave resumen">{{ resumen }}</p>
      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando || faltaDestino || !!tramos.error">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
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

<style scoped>
/* Nuevo horario: fecha y vigencia -> días -> horario -> excepción horaria. */
.horario {
  display: grid;
  gap: 14px;
}
.horario h2 {
  margin: 0;
}
.horario p {
  margin: 0;
}
fieldset {
  margin: 0;
  padding: 12px 14px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  display: grid;
  gap: 8px;
}
legend {
  padding: 0 6px;
  font-weight: 600;
  color: var(--text-h);
  font-size: 0.92rem;
}
legend small {
  font-weight: 400;
}
.activa,
.al-pie {
  align-self: end;
  padding-bottom: 8px;
}
.para {
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--acento-bg);
}
.aviso {
  color: var(--aviso);
}
.resumen {
  font-size: 0.88rem;
}
</style>
