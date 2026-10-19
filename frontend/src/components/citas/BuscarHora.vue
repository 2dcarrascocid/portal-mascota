<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { turnosDisponibles } from '../../composables/useAppointments'
import { fechaCorta, hoy, sumarDias } from '../../lib/fechas'
import { mensajeError } from '../../services/api'
import ReservaCita from './ReservaCita.vue'

// Búsqueda de horas disponibles en dos columnas: filtros a la izquierda
// (sucursal, desde + período, especialidad, especialista) y a la derecha las
// horas en orden cronológico (la primera disponible arriba), paginadas.
// Al elegir una hora se reserva.
const props = defineProps({
  sucursales: { type: Array, required: true },
  profesionales: { type: Array, required: true },
  especialidades: { type: Array, required: true },
  servicios: { type: Array, required: true },
})
const emit = defineEmits(['reservada'])

const { usuario, puede } = useAuth()

const RANGOS = [
  { dias: 1, texto: 'Solo ese día' },
  { dias: 7, texto: '7 días' },
  { dias: 14, texto: '14 días' },
  { dias: 31, texto: '31 días' },
]
const POR_PAGINA = 12

const filtros = reactive({ branchId: '', desde: hoy(), dias: 7, specialtyId: '', staffId: '' })

// Sucursal por defecto: la asignada a quien usa la pantalla (o la única que
// puede ver). Se aplica una sola vez, cuando llegan las listas.
let sucursalInicial = false
watch(
  () => [props.sucursales, props.profesionales],
  () => {
    if (sucursalInicial || !props.sucursales.length) return
    const ids = props.sucursales.map((s) => s.id)
    const propias = props.profesionales.find((p) => p.id === usuario.value?.id)?.branch_ids ?? []
    const asignada = propias.find((b) => ids.includes(b)) ?? (ids.length === 1 ? ids[0] : '')
    if (asignada) filtros.branchId = asignada
    sucursalInicial = true
  },
  { immediate: true }
)

// Las listas se acotan entre sí: especialistas de la sucursal con
// especialidades; especialidades que tiene alguno de ellos.
const deLaSucursal = computed(() =>
  props.profesionales.filter(
    (p) => p.specialty_ids?.length && (!filtros.branchId || p.branch_ids.includes(filtros.branchId))
  )
)
const opcionesEspecialidad = computed(() =>
  props.especialidades.filter((e) => e.is_active && deLaSucursal.value.some((p) => p.specialty_ids.includes(e.id)))
)
const especialistas = computed(() =>
  deLaSucursal.value.filter((p) => !filtros.specialtyId || p.specialty_ids.includes(filtros.specialtyId))
)
// Si lo elegido deja de calzar con los demás filtros, se suelta.
watch(especialistas, (lista) => {
  if (filtros.staffId && !lista.some((p) => p.id === filtros.staffId)) filtros.staffId = ''
})
watch(opcionesEspecialidad, (lista) => {
  if (filtros.specialtyId && !lista.some((e) => e.id === filtros.specialtyId)) filtros.specialtyId = ''
})

// ── Búsqueda ─────────────────────────────────────────────────
const dias = ref([])
const cargando = ref(false)
const error = ref('')
const buscado = ref(false)
const pagina = ref(1)

async function buscar() {
  error.value = ''
  if (!filtros.desde) return // fecha borrada a medio escribir
  cargando.value = true
  try {
    dias.value = await turnosDisponibles({
      desde: filtros.desde,
      hasta: sumarDias(filtros.desde, filtros.dias - 1),
      ...(filtros.branchId && { branchId: filtros.branchId }),
      ...(filtros.specialtyId && { specialtyId: filtros.specialtyId }),
      ...(filtros.staffId && { staffId: filtros.staffId }),
    })
    buscado.value = true
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
}
// Busca sola al cambiar cualquier filtro (y vuelve a la primera página).
watch(
  filtros,
  () => {
    pagina.value = 1
    buscar()
  },
  { deep: true, immediate: true }
)

// Todas las horas en orden: fecha, hora y especialista.
const horas = computed(() =>
  dias.value
    .flatMap((d) =>
      d.agendas.flatMap((a) =>
        a.turnos.map((t) => ({ fecha: d.fecha, inicio: t.inicio, fin: t.fin, staff_id: a.staff_id, branch_id: a.branch_id }))
      )
    )
    .sort((x, y) => x.fecha.localeCompare(y.fecha) || x.inicio.localeCompare(y.inicio) || nombre(x.staff_id).localeCompare(nombre(y.staff_id)))
)
const totalPaginas = computed(() => Math.max(1, Math.ceil(horas.value.length / POR_PAGINA)))
watch(totalPaginas, (n) => {
  if (pagina.value > n) pagina.value = n
})
// Página actual agrupada por fecha.
const porFecha = computed(() => {
  const inicio = (pagina.value - 1) * POR_PAGINA
  const grupos = []
  for (const h of horas.value.slice(inicio, inicio + POR_PAGINA)) {
    if (grupos.at(-1)?.fecha !== h.fecha) grupos.push({ fecha: h.fecha, lista: [] })
    grupos.at(-1).lista.push(h)
  }
  return grupos
})
const esPrimera = (h) => h === horas.value[0]
const clave = (h) => `${h.fecha}${h.inicio}${h.staff_id}`

const profesional = (id) => props.profesionales.find((p) => p.id === id)
const sucursal = (id) => props.sucursales.find((s) => s.id === id)
const nombre = (id) => profesional(id)?.full_name || profesional(id)?.email || 'Profesional'
// Con filtro de especialidad se muestra esa; si no, todas las del especialista.
const especialidadesDe = (id) => {
  const ids = filtros.specialtyId ? [filtros.specialtyId] : (profesional(id)?.specialty_ids ?? [])
  return ids.map((e) => props.especialidades.find((x) => x.id === e)?.name).filter(Boolean)
}

// ── Reserva ──────────────────────────────────────────────────
const elegido = ref(null) // { fecha, inicio, fin, staff_id, branch_id }

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
  <div class="dividida">
    <!-- Izquierda: filtros -->
    <aside class="panel filtros-busqueda" aria-label="Filtros">
      <label>
        Sucursal
        <select v-model="filtros.branchId">
          <option v-if="sucursales.length > 1" value="">Todas</option>
          <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <div class="fila">
        <label>Desde <input v-model="filtros.desde" type="date" :min="hoy()" required /></label>
        <label>
          Período
          <select v-model.number="filtros.dias">
            <option v-for="r in RANGOS" :key="r.dias" :value="r.dias">{{ r.texto }}</option>
          </select>
        </label>
      </div>
      <label>
        Especialidad
        <select v-model="filtros.specialtyId">
          <option value="">Todas</option>
          <option v-for="e in opcionesEspecialidad" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select>
      </label>
      <label>
        Especialista
        <select v-model="filtros.staffId">
          <option value="">Todos</option>
          <option v-for="p in especialistas" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
        </select>
      </label>
      <small v-if="!deLaSucursal.length" class="suave">No hay especialistas con especialidades en esta sucursal.</small>
    </aside>

    <!-- Derecha: resultados -->
    <section class="resultados">
      <ReservaCita
        v-if="elegido"
        :key="clave(elegido)"
        :turno="elegido"
        :profesional="profesional(elegido.staff_id)"
        :sucursal="sucursal(elegido.branch_id)"
        :servicios="serviciosDelProfesional"
        :especialidad-id="filtros.specialtyId"
        @reservada="reservada"
        @ocupado="buscar"
        @cancelar="elegido = null"
      />

      <!-- Un solo panel, para que empiece a la misma altura que los filtros. -->
      <div class="panel lista" :style="{ opacity: cargando && buscado ? 0.6 : 1 }">
        <header class="cabecera">
          <h2>Horas disponibles</h2>
          <small v-if="horas.length" class="suave">
            {{ horas.length }}{{ puede('citas.crear') ? ' · elige una para reservar' : '' }}
          </small>
        </header>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-else-if="aviso" class="ok" role="status">{{ aviso }}</p>

        <p v-if="cargando && !buscado" class="vacio">Buscando…</p>
        <p v-else-if="buscado && !horas.length" class="vacio">
          No hay horas disponibles con estos filtros. Prueba otro período o quita algún filtro.
        </p>

        <template v-else-if="horas.length">
          <template v-for="g in porFecha" :key="g.fecha">
            <h3>{{ fechaCorta(g.fecha, { anio: true }) }}</h3>
            <div
              v-for="h in g.lista"
              :key="clave(h)"
              class="hora"
              :class="{ elegida: elegido && clave(elegido) === clave(h), primera: esPrimera(h) }"
            >
              <div class="tiempo">
                <strong>{{ h.inicio }}</strong>
                <small class="suave">{{ h.fin }}</small>
              </div>
              <div class="datos">
                <div>
                  <strong>{{ nombre(h.staff_id) }}</strong>
                  <span v-if="esPrimera(h)" class="chip destacado">Primera disponible</span>
                </div>
                <div class="chips">
                  <span v-for="e in especialidadesDe(h.staff_id)" :key="e" class="chip gris">{{ e }}</span>
                  <small v-if="!filtros.branchId" class="suave">{{ sucursal(h.branch_id)?.name }}</small>
                </div>
              </div>
              <button v-if="puede('citas.crear')" type="button" class="pequeno" @click="elegido = h">Reservar</button>
            </div>
          </template>

          <nav v-if="totalPaginas > 1" class="paginador" aria-label="Páginas">
            <button type="button" class="secundario pequeno" :disabled="pagina === 1" @click="pagina--">‹ Anterior</button>
            <span>Página {{ pagina }} de {{ totalPaginas }}</span>
            <button type="button" class="secundario pequeno" :disabled="pagina === totalPaginas" @click="pagina++">
              Siguiente ›
            </button>
          </nav>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dividida {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  /* Ambas columnas parten a la misma altura y tienen el mismo alto. */
  align-items: stretch;
}
.filtros-busqueda {
  display: grid;
  gap: 12px;
  align-content: start;
}
.filtros-busqueda label {
  display: grid;
  gap: 4px;
  font-size: 0.85rem;
  min-width: 0;
}
.fila {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.fila input,
.fila select {
  width: 100%;
  min-width: 0;
}
.resultados {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
/* El panel de resultados ocupa el alto restante de la columna. */
.lista {
  flex: 1;
  display: grid;
  align-content: start;
}
.cabecera {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.cabecera h2 {
  margin: 0;
  font-size: 1.05rem;
}
.lista .vacio,
.lista .error,
.lista .ok {
  margin: 4px 0;
}
.lista h3 {
  margin: 12px 0 4px;
  font-size: 0.95rem;
  color: var(--text-suave);
  text-transform: capitalize;
}
.lista h3:first-child {
  margin-top: 0;
}
.hora {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 8px;
  border-top: 1px solid var(--border);
  border-radius: 8px;
}
.hora.primera {
  background: var(--acento-bg);
}
.hora.elegida {
  outline: 2px solid var(--acento);
}
.tiempo {
  display: grid;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.tiempo strong {
  font-size: 1.05rem;
}
.datos {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.chip.destacado {
  margin-left: 6px;
  background: var(--acento);
  color: #fff;
}
.paginador {
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 0.9rem;
}
.ok {
  color: var(--ok);
  margin: 0;
}
@media (max-width: 760px) {
  .dividida {
    grid-template-columns: 1fr;
  }
}
</style>
