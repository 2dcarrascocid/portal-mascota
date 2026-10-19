<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useAppointments } from '../../composables/useAppointments'
import { useAuth } from '../../composables/useAuth'
import { ESTADOS_CITA } from '../../lib/catalogos'
import { fechaCorta, hhmm, hoy, sumarDias } from '../../lib/fechas'
import { api, mensajeError } from '../../services/api'
import SelectorPaciente from './SelectorPaciente.vue'
import { confirmar, pedirTexto } from '../../composables/useDialogo'

// Citas reservadas: seguimiento de estado, cancelación y vínculo con la
// ficha (para las que se tomaron sin tutor/mascota).
const props = defineProps({
  sucursales: { type: Array, required: true },
  profesionales: { type: Array, required: true },
  servicios: { type: Array, required: true },
})

const { puede } = useAuth()
const { items: citas, cargando, error, cargar, cambiarEstado, eliminar } = useAppointments()

const filtros = reactive({ desde: hoy(), hasta: sumarDias(hoy(), 7), branchId: '', staffId: '', estado: '', q: '' })

let espera
function recargar() {
  clearTimeout(espera)
  espera = setTimeout(
    () =>
      cargar(Object.fromEntries(Object.entries(filtros).filter(([, v]) => v))),
    200
  )
}
watch(filtros, recargar, { deep: true, immediate: true })
defineExpose({ recargar })

const porDia = computed(() => {
  const mapa = new Map()
  for (const c of citas.value) {
    if (!mapa.has(c.date)) mapa.set(c.date, [])
    mapa.get(c.date).push(c)
  }
  return [...mapa.entries()].map(([fecha, lista]) => ({ fecha, lista }))
})

const nombre = (id) => {
  const p = props.profesionales.find((x) => x.id === id)
  return p?.full_name || p?.email || 'Profesional'
}
const sucursal = (id) => props.sucursales.find((s) => s.id === id)?.name ?? ''
const servicio = (id) => props.servicios.find((s) => s.id === id)?.name

// Acciones según el estado actual.
const SIGUIENTES = {
  RESERVADA: ['CONFIRMADA', 'ATENDIDA', 'NO_ASISTIO', 'CANCELADA'],
  CONFIRMADA: ['ATENDIDA', 'NO_ASISTIO', 'CANCELADA'],
  LLEGO: [], // en recepción: se cierra o anula desde Recepción
  ATENDIDA: ['RESERVADA'],
  NO_ASISTIO: ['RESERVADA'],
  CANCELADA: ['RESERVADA'],
}
const ETIQUETA_ACCION = {
  RESERVADA: 'Reabrir',
  CONFIRMADA: 'Confirmar',
  ATENDIDA: 'Atendida',
  NO_ASISTIO: 'No asistió',
  CANCELADA: 'Cancelar',
}

const ocupado = ref('')
async function estado(c, status) {
  let reason
  if (status === 'CANCELADA') {
    reason = await pedirTexto({
      titulo: 'Cancelar cita',
      etiqueta: 'Motivo de la cancelación (opcional)',
      aceptar: 'Cancelar cita',
      cancelar: 'Volver',
      peligro: true,
    })
    if (reason === null) return
  }
  ocupado.value = c.id
  error.value = ''
  try {
    await cambiarEstado(c.id, { status, reason })
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    ocupado.value = ''
  }
}

async function borrar(c) {
  const mensaje = `¿Eliminar la cita de ${c.contact_name} (${fechaCorta(c.date)} ${hhmm(c.start_time)})? Úsalo solo si se ingresó por error; si no, cancélala.`
  if (!(await confirmar({ titulo: 'Eliminar cita', mensaje: mensaje, aceptar: 'Eliminar', peligro: true }))) return
  try {
    await eliminar(c.id)
  } catch (err) {
    error.value = mensajeError(err)
  }
}

// ── Vincular ficha ───────────────────────────────────────────
const vinculando = ref(null) // cita
const tutor = ref(null)
const mascota = ref('')
const errorVinculo = ref('')

function abrirVinculo(c) {
  vinculando.value = c
  tutor.value = null
  mascota.value = ''
  errorVinculo.value = ''
}

async function vincular() {
  errorVinculo.value = ''
  const c = vinculando.value
  try {
    const { data } = await api.put(`/citas/${c.id}`, {
      client_id: tutor.value.id,
      pet_id: mascota.value || null,
      // Se conserva el contacto con que se tomó la hora.
      contact_name: c.contact_name,
      contact_phone: c.contact_phone,
      contact_email: c.contact_email,
      service_id: c.service_id,
      specialty_id: c.specialty_id,
      notes: c.notes,
    })
    citas.value = citas.value.map((x) => (x.id === c.id ? data.cita : x))
    vinculando.value = null
  } catch (err) {
    errorVinculo.value = mensajeError(err)
  }
}
</script>

<template>
  <div class="pagina">
    <div class="filtros">
      <label>Desde <input v-model="filtros.desde" type="date" /></label>
      <label>Hasta <input v-model="filtros.hasta" type="date" :min="filtros.desde || undefined" /></label>
      <label>
        Sucursal
        <select v-model="filtros.branchId">
          <option value="">Todas</option>
          <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label>
        Especialista
        <select v-model="filtros.staffId">
          <option value="">Todos</option>
          <option v-for="p in profesionales" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
        </select>
      </label>
      <label>
        Estado
        <select v-model="filtros.estado">
          <option value="">Todos</option>
          <option v-for="(etiqueta, valor) in ESTADOS_CITA" :key="valor" :value="valor">{{ etiqueta }}</option>
        </select>
      </label>
      <label style="flex: 1; min-width: 180px">
        Buscar
        <input v-model="filtros.q" type="search" placeholder="Contacto, teléfono, RUT o mascota" />
      </label>
    </div>

    <form v-if="vinculando" class="panel" @submit.prevent="vincular">
      <h2>Vincular ficha</h2>
      <p class="suave" style="margin-top: 0">
        Cita de <strong>{{ vinculando.contact_name }}</strong>
        {{ vinculando.contact_phone ? `(${vinculando.contact_phone})` : '' }} · {{ fechaCorta(vinculando.date) }}
        {{ hhmm(vinculando.start_time) }}
      </p>
      <SelectorPaciente v-model:tutor="tutor" v-model:mascota="mascota" />
      <p v-if="errorVinculo" class="error" role="alert">{{ errorVinculo }}</p>
      <div class="acciones">
        <button :disabled="!tutor">Vincular</button>
        <button type="button" class="secundario" @click="vinculando = null">Cancelar</button>
      </div>
    </form>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="cargando && !citas.length" class="vacio">Cargando…</p>
    <p v-else-if="!citas.length" class="panel vacio">No hay citas con estos filtros.</p>

    <section v-for="d in porDia" :key="d.fecha" class="panel tabla-contenedor">
      <h3>{{ fechaCorta(d.fecha, { anio: true }) }} <small class="suave">· {{ d.lista.length }} cita(s)</small></h3>
      <table class="tabla">
        <tbody>
          <tr
            v-for="c in d.lista"
            :key="c.id"
            :style="{ opacity: ocupado === c.id ? 0.5 : c.status === 'CANCELADA' ? 0.55 : 1 }"
          >
            <td><strong>{{ hhmm(c.start_time) }}</strong><small class="suave">–{{ hhmm(c.end_time) }}</small></td>
            <td>
              <template v-if="c.client">
                <strong>{{ c.client.first_name }} {{ c.client.last_name }}</strong>
                <span v-if="c.pet"> · 🐾 {{ c.pet.name }}</span>
              </template>
              <template v-else>
                <strong>{{ c.contact_name }}</strong> <span class="chip gris">Sin ficha</span>
              </template>
              <div><small class="suave">{{ c.contact_phone }}</small></div>
              <div v-if="c.notes"><small class="suave">{{ c.notes }}</small></div>
            </td>
            <td>
              {{ nombre(c.staff_id) }}
              <div><small class="suave">{{ sucursal(c.branch_id) }}{{ servicio(c.service_id) ? ` · ${servicio(c.service_id)}` : '' }}</small></div>
            </td>
            <td>
              <span class="chip" :class="c.status.toLowerCase()">{{ ESTADOS_CITA[c.status] }}</span>
              <span v-if="c.payment_status === 'PAGADO'" class="chip gris" title="Reservada y pagada en el portal del tutor">Pagada en línea</span>
              <span v-else-if="c.payment_status === 'PENDIENTE'" class="chip gris" title="El tutor aún no completa el pago">Pago pendiente</span>
              <div v-if="c.cancel_reason"><small class="suave">{{ c.cancel_reason }}</small></div>
            </td>
            <td>
              <div class="acciones">
                <template v-if="puede('citas.editar')">
                  <button
                    v-for="s in SIGUIENTES[c.status]"
                    :key="s"
                    class="pequeno"
                    :class="s === 'CANCELADA' ? 'peligro' : 'secundario'"
                    :disabled="ocupado === c.id"
                    @click="estado(c, s)"
                  >
                    {{ ETIQUETA_ACCION[s] }}
                  </button>
                  <button v-if="!c.client_id" class="secundario pequeno" @click="abrirVinculo(c)">Vincular ficha</button>
                </template>
                <button v-if="puede('citas.eliminar')" class="peligro pequeno" @click="borrar(c)">Eliminar</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.panel h3 {
  margin: 0 0 8px;
}
.chip.confirmada {
  background: color-mix(in srgb, var(--ok) 15%, transparent);
  color: var(--ok);
}
.chip.llego {
  background: color-mix(in srgb, var(--aviso) 18%, transparent);
  color: var(--aviso);
}
.chip.atendida {
  background: var(--border);
  color: var(--text-h);
}
.chip.no_asistio,
.chip.cancelada {
  background: color-mix(in srgb, var(--peligro) 14%, transparent);
  color: var(--peligro);
}
</style>
