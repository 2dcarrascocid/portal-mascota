<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { turnosDisponibles } from '../../composables/useAppointments'
import { ROLES } from '../../lib/catalogos'
import { fechaCorta, hoy, sumarDias } from '../../lib/fechas'
import { mensajeError } from '../../services/api'
import ReservaCita from './ReservaCita.vue'

// Búsqueda de horas disponibles: por fecha, especialista, cargo,
// especialidad (y sucursal / servicio). Al elegir un turno se reserva.
const props = defineProps({
  sucursales: { type: Array, required: true },
  profesionales: { type: Array, required: true },
  especialidades: { type: Array, required: true },
  servicios: { type: Array, required: true },
})
const emit = defineEmits(['reservada'])

const { puede } = useAuth()

const CARGOS = ['VET', 'GROOMER', 'TRAINER', 'ORG_ADMIN']
const RANGOS = [
  { dias: 1, texto: 'Solo ese día' },
  { dias: 7, texto: '7 días' },
  { dias: 14, texto: '14 días' },
  { dias: 31, texto: '31 días' },
]

const filtros = reactive({
  desde: hoy(),
  dias: 7,
  branchId: '',
  cargo: '',
  specialtyId: '',
  serviceId: '',
  staffId: '',
})

// Las listas se acotan entre sí: especialistas según cargo/especialidad.
const especialidadesVisibles = computed(() => props.especialidades.filter((e) => e.is_active))
const especialistas = computed(() =>
  props.profesionales.filter(
    (p) =>
      (!filtros.cargo || p.role === filtros.cargo) &&
      (!filtros.specialtyId || p.specialty_ids.includes(filtros.specialtyId)) &&
      (!filtros.branchId || p.branch_ids.includes(filtros.branchId))
  )
)
const serviciosVisibles = computed(() =>
  props.servicios.filter(
    (s) => s.is_active && (!filtros.specialtyId || !s.specialty_ids.length || s.specialty_ids.includes(filtros.specialtyId))
  )
)
// Si el especialista elegido deja de calzar con los filtros, se suelta.
watch(especialistas, (lista) => {
  if (filtros.staffId && !lista.some((p) => p.id === filtros.staffId)) filtros.staffId = ''
})

const dias = ref([])
const cargando = ref(false)
const error = ref('')
const buscado = ref(false)

async function buscar() {
  error.value = ''
  if (!filtros.desde) return // fecha borrada a medio escribir
  cargando.value = true
  try {
    dias.value = await turnosDisponibles({
      desde: filtros.desde,
      hasta: sumarDias(filtros.desde, filtros.dias - 1),
      ...(filtros.branchId && { branchId: filtros.branchId }),
      ...(filtros.cargo && { cargo: filtros.cargo }),
      ...(filtros.specialtyId && { specialtyId: filtros.specialtyId }),
      ...(filtros.serviceId && { serviceId: filtros.serviceId }),
      ...(filtros.staffId && { staffId: filtros.staffId }),
    })
    buscado.value = true
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
}
// Busca sola al cambiar cualquier filtro.
watch(filtros, buscar, { deep: true, immediate: true })

const conHoras = computed(() => dias.value.filter((d) => d.agendas.length))
const totalTurnos = computed(() => conHoras.value.reduce((n, d) => n + d.agendas.reduce((m, a) => m + a.turnos.length, 0), 0))

const profesional = (id) => props.profesionales.find((p) => p.id === id)
const sucursal = (id) => props.sucursales.find((s) => s.id === id)
const nombre = (id) => profesional(id)?.full_name || profesional(id)?.email || 'Profesional'
const especialidadesDe = (id) =>
  (profesional(id)?.specialty_ids ?? []).map((e) => props.especialidades.find((x) => x.id === e)?.name).filter(Boolean)

// ── Reserva ──────────────────────────────────────────────────
const elegido = ref(null) // { fecha, inicio, fin, staff_id, branch_id }
const panelReserva = ref(null)

async function elegir(dia, agenda, turno) {
  elegido.value = { fecha: dia.fecha, inicio: turno.inicio, fin: turno.fin, staff_id: agenda.staff_id, branch_id: agenda.branch_id }
  await nextTick()
  panelReserva.value?.$el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Servicios que puede realizar el profesional (por sus especialidades; los
// servicios sin especialidad asignada los ofrece cualquiera).
const serviciosDelProfesional = computed(() => {
  const p = elegido.value && profesional(elegido.value.staff_id)
  if (!p) return []
  return props.servicios.filter(
    (s) => s.is_active && (!s.specialty_ids.length || s.specialty_ids.some((e) => p.specialty_ids.includes(e)))
  )
})

const aviso = ref('')
function reservada(cita) {
  aviso.value = `Cita reservada: ${fechaCorta(cita.date)} a las ${cita.start_time.slice(0, 5)} con ${nombre(cita.staff_id)} (${cita.contact_name}).`
  elegido.value = null
  emit('reservada', cita)
  buscar()
}
</script>

<template>
  <div class="pagina">
    <section class="panel filtros-busqueda">
      <label>Desde <input v-model="filtros.desde" type="date" :min="hoy()" required /></label>
      <label>
        Período
        <select v-model.number="filtros.dias">
          <option v-for="r in RANGOS" :key="r.dias" :value="r.dias">{{ r.texto }}</option>
        </select>
      </label>
      <label>
        Sucursal
        <select v-model="filtros.branchId">
          <option value="">Todas</option>
          <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label>
        Cargo
        <select v-model="filtros.cargo">
          <option value="">Todos</option>
          <option v-for="c in CARGOS" :key="c" :value="c">{{ ROLES[c] }}</option>
        </select>
      </label>
      <label>
        Especialidad
        <select v-model="filtros.specialtyId">
          <option value="">Todas</option>
          <option v-for="e in especialidadesVisibles" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select>
      </label>
      <label>
        Servicio
        <select v-model="filtros.serviceId">
          <option value="">Todos</option>
          <option v-for="s in serviciosVisibles" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label>
        Especialista
        <select v-model="filtros.staffId">
          <option value="">Todos</option>
          <option v-for="p in especialistas" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
        </select>
      </label>
    </section>

    <ReservaCita
      v-if="elegido"
      ref="panelReserva"
      :key="`${elegido.staff_id}${elegido.fecha}${elegido.inicio}`"
      :turno="elegido"
      :profesional="profesional(elegido.staff_id)"
      :sucursal="sucursal(elegido.branch_id)"
      :servicios="serviciosDelProfesional"
      :servicio-id="filtros.serviceId"
      :especialidad-id="filtros.specialtyId"
      @reservada="reservada"
      @ocupado="buscar"
      @cancelar="elegido = null"
    />

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="aviso" class="ok" role="status">{{ aviso }}</p>

    <p v-if="cargando && !buscado" class="vacio">Buscando…</p>
    <p v-else-if="buscado && !conHoras.length" class="panel vacio">
      No hay horas disponibles con estos filtros. Prueba otro período o quita algún filtro.
    </p>
    <small v-else-if="buscado" class="suave">
      {{ totalTurnos }} horas disponibles{{ puede('citas.crear') ? ' · elige una para reservar' : '' }}
    </small>

    <section v-for="d in conHoras" :key="d.fecha" class="panel" :style="{ opacity: cargando ? 0.6 : 1 }">
      <h3>{{ fechaCorta(d.fecha, { anio: true }) }}</h3>
      <div v-for="a in d.agendas" :key="a.staff_id + a.branch_id" class="agenda">
        <div>
          <strong>{{ nombre(a.staff_id) }}</strong>
          <small class="suave">
            · {{ ROLES[profesional(a.staff_id)?.role] }} · {{ sucursal(a.branch_id)?.name }}
            <template v-if="especialidadesDe(a.staff_id).length"> · {{ especialidadesDe(a.staff_id).join(', ') }}</template>
          </small>
        </div>
        <div class="chips">
          <button
            v-for="t in a.turnos"
            :key="t.inicio"
            type="button"
            class="turno"
            :class="{
              elegido: elegido && elegido.staff_id === a.staff_id && elegido.fecha === d.fecha && elegido.inicio === t.inicio,
            }"
            :disabled="!puede('citas.crear')"
            :title="`${t.inicio} – ${t.fin}`"
            @click="elegir(d, a, t)"
          >
            {{ t.inicio }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.filtros-busqueda {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.filtros-busqueda label {
  display: grid;
  gap: 4px;
  font-size: 0.85rem;
}
.agenda {
  display: grid;
  gap: 6px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
}
.agenda:first-of-type {
  border-top: 0;
}
button.turno {
  padding: 4px 10px;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  background: var(--superficie);
  color: var(--text-h);
  border: 1px solid var(--border);
}
button.turno:hover:not(:disabled) {
  background: var(--acento-bg);
  border-color: var(--acento);
}
button.turno.elegido {
  background: var(--acento);
  border-color: var(--acento);
  color: #fff;
}
button.turno:disabled {
  opacity: 1;
}
.ok {
  color: var(--ok);
  margin: 0;
}
</style>
