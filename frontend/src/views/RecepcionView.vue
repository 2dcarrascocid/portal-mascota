<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AtencionEspontanea from '../components/recepcion/AtencionEspontanea.vue'
import DetalleAtencion from '../components/recepcion/DetalleAtencion.vue'
import { useAuth } from '../composables/useAuth'
import { useBranches } from '../composables/useBranches'
import { atiendenEn, especialidadesDe, pesos, useReception } from '../composables/useReception'
import { useServices } from '../composables/useServices'
import { useSpecialties } from '../composables/useSpecialties'
import { useStaff } from '../composables/useStaff'
import { fechaCorta, hhmm, hoy } from '../lib/fechas'
import { mensajeError } from '../services/api'

// Módulo Recepción: listado de las mascotas del día (con cita o
// espontáneas), identificación por teléfono o nombre, marca de llegada
// (solo el día de hoy) y atención hasta el cierre. El personal que no es
// administrador ve solo sus sucursales asignadas, y en los filtros solo el
// personal con especialidades de esas sucursales.
const { puede, esAdminOrg } = useAuth()
const { items: sucursales, cargar: cargarSucursales } = useBranches()
const { personal, cargar: cargarPersonal } = useStaff()
const { items: especialidades, cargar: cargarEspecialidades } = useSpecialties()
const { items: servicios, cargar: cargarServicios } = useServices()
const { citas, atenciones, sinSucursal, cargando, error, cargar, recibir } = useReception()

const filtros = reactive({ branchId: '', fecha: hoy(), specialtyId: '', staffId: '', estado: '', q: '' })
const esHoy = computed(() => filtros.fecha === hoy())

onMounted(async () => {
  await Promise.all([cargarSucursales(), cargarPersonal(), cargarEspecialidades(), cargarServicios()])
  if (sucursales.value.length === 1) filtros.branchId = sucursales.value[0].id
})
const recargar = () => cargar({ fecha: filtros.fecha || hoy(), ...(filtros.branchId && { branchId: filtros.branchId }) })
watch(() => [filtros.branchId, filtros.fecha], recargar, { immediate: true })

// ── Personal y especialidades de la(s) sucursal(es) ─────────
const idsSucursales = computed(() => (filtros.branchId ? [filtros.branchId] : sucursales.value.map((s) => s.id)))
const profesionales = computed(() => atiendenEn(personal.value, idsSucursales.value))
const opcionesEspecialidad = computed(() => especialidadesDe(profesionales.value, especialidades.value))
const opcionesProfesional = computed(() =>
  profesionales.value.filter((p) => !filtros.specialtyId || p.specialty_ids.includes(filtros.specialtyId))
)
// Al cambiar la sucursal o la especialidad, el profesional elegido puede dejar de estar.
watch(opcionesProfesional, (lista) => {
  if (filtros.staffId && !lista.some((p) => p.id === filtros.staffId)) filtros.staffId = ''
})
watch(opcionesEspecialidad, (lista) => {
  if (filtros.specialtyId && !lista.some((e) => e.id === filtros.specialtyId)) filtros.specialtyId = ''
})

const persona = (id) => personal.value.find((x) => x.id === id)
const nombre = (id) => persona(id)?.full_name || persona(id)?.email || ''
const especialidad = (id) => especialidades.value.find((e) => e.id === id)?.name
const sucursal = (id) => sucursales.value.find((s) => s.id === id)?.name ?? ''
const servicio = (id) => servicios.value.find((s) => s.id === id)?.name
const horaDe = (iso) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

// ── Listado único: citas del día (con su atención) + espontáneas ──
// estado: RESERVADA | CONFIRMADA | NO_ASISTIO (por llegar), EN_ATENCION, ATENDIDA, ANULADA
const ESTADOS = {
  RESERVADA: 'Reservada',
  CONFIRMADA: 'Confirmada',
  NO_ASISTIO: 'No asistió',
  EN_ATENCION: 'En atención',
  ATENDIDA: 'Atendida',
  ANULADA: 'Anulada',
}
const GRUPOS = [
  { clave: '', texto: 'Todas' },
  { clave: 'por_llegar', texto: 'Por llegar', estados: ['RESERVADA', 'CONFIRMADA', 'NO_ASISTIO'] },
  { clave: 'en_atencion', texto: 'En atención', estados: ['EN_ATENCION'] },
  { clave: 'atendidas', texto: 'Atendidas', estados: ['ATENDIDA'] },
  { clave: 'anuladas', texto: 'Anuladas', estados: ['ANULADA'] },
]
const RECIBIBLES = ['RESERVADA', 'CONFIRMADA', 'NO_ASISTIO']

const estadoDe = (cita, atencion) => {
  if (atencion) return { ABIERTA: 'EN_ATENCION', CERRADA: 'ATENDIDA', ANULADA: 'ANULADA' }[atencion.status]
  return cita.status === 'LLEGO' ? 'EN_ATENCION' : cita.status
}

const filas = computed(() => {
  const porId = new Map(atenciones.value.map((a) => [a.id, a]))
  const conCita = citas.value.map((c) => {
    const a = c.visit ? porId.get(c.visit.id) : null
    return {
      clave: `c-${c.id}`,
      orden: c.start_time,
      hora: hhmm(c.start_time),
      cita: c,
      atencion: a,
      llegada: a && horaDe(a.arrived_at),
      pet: c.pet,
      pet_name: c.pet?.name,
      client: c.client,
      contact_name: c.contact_name,
      contact_phone: c.contact_phone,
      staff_id: a?.staff_id ?? c.staff_id,
      specialty_id: a?.specialty_id ?? c.specialty_id,
      branch_id: c.branch_id,
      service_id: c.service_id,
      estado: estadoDe(c, a),
    }
  })
  const espontaneas = atenciones.value
    .filter((a) => !a.appointment_id)
    .map((a) => ({
      clave: `a-${a.id}`,
      orden: horaDe(a.arrived_at),
      hora: horaDe(a.arrived_at),
      cita: null,
      atencion: a,
      llegada: horaDe(a.arrived_at),
      pet: a.pet,
      pet_name: a.pet?.name || a.pet_name,
      client: a.client,
      contact_name: a.contact_name,
      contact_phone: a.contact_phone,
      staff_id: a.staff_id,
      specialty_id: a.specialty_id,
      branch_id: a.branch_id,
      service_id: null,
      estado: estadoDe(null, a),
    }))
  return [...conCita, ...espontaneas].sort((x, y) => x.orden.localeCompare(y.orden))
})

// Identificación: teléfono (solo dígitos) o nombre de tutor/mascota/RUT.
const digitos = (t) => String(t || '').replace(/\D/g, '')
const normal = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

function coincideTexto(f) {
  const q = filtros.q.trim()
  if (!q) return true
  const d = digitos(q)
  if (d.length >= 4 && [f.contact_phone, f.client?.phone].some((t) => digitos(t).includes(d))) return true
  const texto = normal(q)
  return [f.contact_name, f.pet_name, f.client && `${f.client.first_name} ${f.client.last_name}`, f.client?.national_id].some(
    (t) => normal(t).includes(texto)
  )
}

// Sin especialidad en la cita/atención, cuenta la del profesional.
const especialidadesFila = (f) => (f.specialty_id ? [f.specialty_id] : (persona(f.staff_id)?.specialty_ids ?? []))

const sinEstado = computed(() =>
  filas.value.filter(
    (f) =>
      coincideTexto(f) &&
      (!filtros.staffId || f.staff_id === filtros.staffId) &&
      (!filtros.specialtyId || especialidadesFila(f).includes(filtros.specialtyId))
  )
)
const grupo = computed(() => GRUPOS.find((g) => g.clave === filtros.estado))
const visibles = computed(() =>
  grupo.value?.estados ? sinEstado.value.filter((f) => grupo.value.estados.includes(f.estado)) : sinEstado.value
)
const cuenta = (g) => (g.estados ? sinEstado.value.filter((f) => g.estados.includes(f.estado)).length : sinEstado.value.length)

// ── Características de la mascota ────────────────────────────
function edad(nacimiento) {
  if (!nacimiento) return ''
  const [a, m, d] = nacimiento.split('-').map(Number)
  const ahora = new Date()
  let meses = (ahora.getFullYear() - a) * 12 + (ahora.getMonth() + 1 - m) - (ahora.getDate() < d ? 1 : 0)
  if (meses < 0) meses = 0
  if (meses < 12) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`
  const anios = Math.floor(meses / 12)
  return `${anios} ${anios === 1 ? 'año' : 'años'}`
}
const rasgos = (pet) =>
  pet
    ? [pet.species?.name, pet.breed?.name, edad(pet.birth_date), pet.weight && `${Number(pet.weight)} kg`].filter(Boolean)
    : []
const tutorDe = (f) => (f.client ? `${f.client.first_name} ${f.client.last_name}` : f.contact_name)

// ── Acciones ─────────────────────────────────────────────────
const abierta = ref(null) // id de la atención en el detalle
const detalle = computed(() => atenciones.value.find((a) => a.id === abierta.value))
const espontanea = ref(false)
const ocupado = ref('')

async function marcarLlegada(c) {
  ocupado.value = c.id
  error.value = ''
  try {
    const atencion = await recibir({ appointment_id: c.id })
    filtros.q = ''
    abierta.value = atencion.id // sigue con observaciones/prestaciones
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    ocupado.value = ''
  }
}

function alRecibir(atencion) {
  espontanea.value = false
  filtros.q = ''
  abierta.value = atencion.id
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Recepción</h1>
      <button v-if="puede('recepcion.crear') && esHoy && !sinSucursal" @click="espontanea = true">
        + Atención espontánea
      </button>
    </div>

    <p v-if="sinSucursal" class="panel aviso">
      No tienes una sucursal asignada. Pide al administrador que te asigne a una en Configuración › Personal para
      recibir mascotas.
    </p>

    <template v-else>
      <div class="filtros">
        <label>
          Sucursal
          <select v-model="filtros.branchId">
            <option v-if="esAdminOrg || sucursales.length > 1" value="">Todas</option>
            <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label>
          Fecha
          <span class="fecha">
            <input v-model="filtros.fecha" type="date" required />
            <button v-if="!esHoy" type="button" class="secundario pequeno" @click="filtros.fecha = hoy()">Hoy</button>
          </span>
        </label>
        <label>
          Especialidad
          <select v-model="filtros.specialtyId">
            <option value="">Todas</option>
            <option v-for="e in opcionesEspecialidad" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
        </label>
        <label>
          Profesional
          <select v-model="filtros.staffId">
            <option value="">Todos</option>
            <option v-for="p in opcionesProfesional" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
          </select>
        </label>
        <label class="buscar">
          Identificar mascota
          <input v-model="filtros.q" type="search" placeholder="Teléfono, nombre del tutor o de la mascota" />
        </label>
      </div>

      <p v-if="!esHoy" class="aviso">
        Vista de consulta del {{ fechaCorta(filtros.fecha, { anio: true }) }}: la llegada solo se marca el día de hoy.
      </p>

      <div class="acciones" role="tablist" aria-label="Estado">
        <button
          v-for="g in GRUPOS"
          :key="g.clave"
          role="tab"
          :aria-selected="filtros.estado === g.clave"
          class="pequeno"
          :class="{ secundario: filtros.estado !== g.clave }"
          @click="filtros.estado = g.clave"
        >
          {{ g.texto }} <span class="contador">{{ cuenta(g) }}</span>
        </button>
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <section class="panel tabla-contenedor">
        <p v-if="cargando && !filas.length" class="suave">Cargando…</p>
        <template v-else-if="!visibles.length">
          <p class="suave">
            {{ filtros.q ? `No hay mascotas para «${filtros.q}» con estos filtros.` : 'No hay mascotas con estos filtros.' }}
          </p>
          <button
            v-if="filtros.q && esHoy && puede('recepcion.crear')"
            class="secundario pequeno"
            @click="espontanea = true"
          >
            Registrar como atención espontánea
          </button>
        </template>
        <table v-else class="tabla">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Mascota</th>
              <th>Tutor</th>
              <th>Especialidad</th>
              <th>Profesional</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in visibles" :key="f.clave" :class="{ apagada: f.estado === 'ANULADA' }" :style="{ opacity: ocupado === f.cita?.id ? 0.5 : undefined }">
              <td>
                <strong>{{ f.hora }}</strong>
                <div>
                  <small class="suave">{{ f.cita ? 'Cita' : 'Espontánea' }}</small>
                </div>
              </td>
              <td>
                <strong>🐾 {{ f.pet_name || 'Sin indicar' }}</strong>
                <div v-if="rasgos(f.pet).length"><small class="suave">{{ rasgos(f.pet).join(' · ') }}</small></div>
              </td>
              <td>
                {{ tutorDe(f) }}
                <span v-if="!f.client" class="chip gris">Sin ficha</span>
                <div>
                  <small class="suave">{{ [f.contact_phone, f.client?.national_id].filter(Boolean).join(' · ') }}</small>
                </div>
              </td>
              <td>
                <template v-if="f.specialty_id">{{ especialidad(f.specialty_id) }}</template>
                <small v-else class="suave">{{ especialidadesFila(f).map(especialidad).filter(Boolean).join(', ') || '—' }}</small>
                <div v-if="servicio(f.service_id)"><small class="suave">{{ servicio(f.service_id) }}</small></div>
              </td>
              <td>
                {{ nombre(f.staff_id) || 'Sin asignar' }}
                <div v-if="!filtros.branchId"><small class="suave">{{ sucursal(f.branch_id) }}</small></div>
              </td>
              <td>
                <span class="chip" :class="f.estado.toLowerCase()">{{ ESTADOS[f.estado] }}</span>
                <div v-if="f.llegada"><small class="suave">llegó {{ f.llegada }}</small></div>
                <div v-if="f.atencion?.status === 'ABIERTA'" class="progreso">
                  <span :class="{ listo: f.atencion.observations }">Obs.</span>
                  <span :class="{ listo: f.atencion.items.length }">Prest. {{ f.atencion.items.length || '' }}</span>
                  <span :class="{ listo: f.atencion.items.length && f.atencion.saldo <= 0 }">
                    {{ f.atencion.items.length && f.atencion.saldo <= 0 ? 'Pagado' : `Saldo ${pesos(f.atencion.saldo)}` }}
                  </span>
                </div>
                <div v-else-if="f.estado === 'ATENDIDA' && f.atencion"><small class="suave">{{ pesos(f.atencion.total) }}</small></div>
              </td>
              <td class="derecha">
                <button
                  v-if="f.atencion"
                  class="pequeno"
                  :class="{ secundario: f.atencion.status !== 'ABIERTA' }"
                  @click="abierta = f.atencion.id"
                >
                  {{ f.atencion.status === 'ABIERTA' ? 'Atender' : 'Ver' }}
                </button>
                <button
                  v-else-if="f.cita && esHoy && RECIBIBLES.includes(f.estado) && puede('recepcion.crear')"
                  class="pequeno"
                  :disabled="ocupado === f.cita.id"
                  @click="marcarLlegada(f.cita)"
                >
                  Marcar llegada
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <DetalleAtencion
      v-if="detalle"
      :atencion="detalle"
      :sucursales="sucursales"
      :personal="personal"
      :especialidades="especialidades"
      :servicios="servicios"
      @cerrar="abierta = null"
    />
    <AtencionEspontanea
      v-if="espontanea"
      :sucursales="sucursales"
      :personal="personal"
      :especialidades="especialidades"
      :branch-id="filtros.branchId"
      :busqueda="filtros.q"
      @cerrar="espontanea = false"
      @recibida="alRecibir"
    />
  </main>
</template>

<style scoped>
.buscar {
  flex: 1;
  min-width: 220px;
}
.fecha {
  display: flex;
  gap: 6px;
  align-items: center;
}
.aviso {
  color: var(--aviso);
  margin: 0;
}
.contador {
  margin-left: 4px;
  font-size: 0.75rem;
  font-weight: 700;
}
.derecha {
  text-align: right;
  white-space: nowrap;
}
.apagada {
  opacity: 0.55;
}
.progreso {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.progreso span {
  font-size: 0.72rem;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--border);
  color: var(--text-suave);
  white-space: nowrap;
}
.progreso span.listo {
  background: color-mix(in srgb, var(--ok) 15%, transparent);
  color: var(--ok);
}
.chip.confirmada,
.chip.atendida {
  background: color-mix(in srgb, var(--ok) 15%, transparent);
  color: var(--ok);
}
.chip.en_atencion {
  background: color-mix(in srgb, var(--aviso) 18%, transparent);
  color: var(--aviso);
}
.chip.no_asistio,
.chip.anulada {
  background: color-mix(in srgb, var(--peligro) 14%, transparent);
  color: var(--peligro);
}
</style>
