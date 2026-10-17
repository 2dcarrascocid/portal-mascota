<script setup>
import { computed, reactive, ref, watch } from 'vue'
import ModalDialogo from '../ModalDialogo.vue'
import { atiendenEn, especialidadesDe, pesos, useReception } from '../../composables/useReception'
import { useAuth } from '../../composables/useAuth'
import { ESTADOS_ATENCION, MEDIOS_PAGO } from '../../lib/catalogos'
import { hhmm } from '../../lib/fechas'
import { mensajeError } from '../../services/api'

// Atención de una mascota en recepción, paso a paso:
// llegada -> observaciones -> prestaciones -> pago -> cierre.
const props = defineProps({
  atencion: { type: Object, required: true },
  sucursales: { type: Array, required: true },
  personal: { type: Array, required: true },
  especialidades: { type: Array, required: true },
  servicios: { type: Array, required: true },
})
const emit = defineEmits(['cerrar'])

const { puede } = useAuth()
const recepcion = useReception()
const a = computed(() => props.atencion)
const editable = computed(() => a.value.status === 'ABIERTA' && puede('recepcion.editar'))
const error = ref('')
const ocupado = ref(false)

async function ejecutar(fn) {
  error.value = ''
  ocupado.value = true
  try {
    await fn()
    return true
  } catch (err) {
    error.value = mensajeError(err)
    return false
  } finally {
    ocupado.value = false
  }
}

const nombre = (id) => {
  const p = props.personal.find((x) => x.id === id)
  return p?.full_name || p?.email || ''
}
const sucursal = computed(() => props.sucursales.find((s) => s.id === a.value.branch_id)?.name ?? '')
const tutor = computed(() =>
  a.value.client ? `${a.value.client.first_name} ${a.value.client.last_name}` : a.value.contact_name
)
const mascota = computed(() => a.value.pet?.name || a.value.pet_name || 'Mascota sin indicar')
const llegada = computed(() =>
  new Date(a.value.arrived_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
)

// ── Pasos ────────────────────────────────────────────────────
const pasos = computed(() => [
  { texto: 'Llegada', listo: true },
  { texto: 'Observaciones', listo: !!a.value.observations },
  { texto: 'Prestaciones', listo: a.value.items.length > 0 },
  { texto: 'Pago', listo: a.value.items.length > 0 && a.value.saldo <= 0 },
  { texto: 'Cierre', listo: a.value.status === 'CERRADA' },
])

// ── 1. Observaciones ─────────────────────────────────────────
const obs = reactive({ observations: '', staff_id: '', specialty_id: '' })
watch(
  () => [a.value.id, a.value.observations, a.value.staff_id, a.value.specialty_id],
  () => {
    obs.observations = a.value.observations || ''
    obs.staff_id = a.value.staff_id || ''
    obs.specialty_id = a.value.specialty_id || ''
  },
  { immediate: true }
)
const obsCambiadas = computed(
  () =>
    obs.observations !== (a.value.observations || '') ||
    obs.staff_id !== (a.value.staff_id || '') ||
    obs.specialty_id !== (a.value.specialty_id || '')
)
const guardarObservaciones = () =>
  ejecutar(() =>
    recepcion.actualizar(a.value.id, {
      observations: obs.observations,
      staff_id: obs.staff_id || null,
      specialty_id: obs.specialty_id || null,
    })
  )

// Solo el personal de la sucursal con especialidades; la especialidad
// elegida acota a quienes la tienen, y el profesional elegido, sus especialidades.
const deLaSucursal = computed(() => atiendenEn(props.personal, [a.value.branch_id]))
const opcionesEspecialidad = computed(() => {
  const elegido = deLaSucursal.value.find((p) => p.id === obs.staff_id)
  return especialidadesDe(elegido ? [elegido] : deLaSucursal.value, props.especialidades)
})
const opcionesProfesional = computed(() => {
  const lista = deLaSucursal.value.filter((p) => !obs.specialty_id || p.specialty_ids.includes(obs.specialty_id))
  // El profesional de la cita se conserva aunque ya no esté en la sucursal.
  const actual = props.personal.find((p) => p.id === a.value.staff_id)
  return actual && !lista.some((p) => p.id === actual.id) ? [actual, ...lista] : lista
})

// ── 2. Prestaciones ──────────────────────────────────────────
const LIBRE = 'libre'
const serviciosActivos = computed(() => props.servicios.filter((s) => s.is_active))
const nueva = reactive({ service_id: '', description: '', quantity: 1, unit_price: '' })

function elegirServicio(id) {
  nueva.service_id = id
  const s = props.servicios.find((x) => x.id === id)
  nueva.description = ''
  nueva.unit_price = s ? Number(s.price) : ''
}

async function agregarPrestacion() {
  const libre = nueva.service_id === LIBRE
  const ok = await ejecutar(() =>
    recepcion.agregarPrestacion(a.value.id, {
      service_id: libre ? null : nueva.service_id,
      description: libre ? nueva.description : null,
      quantity: nueva.quantity,
      unit_price: nueva.unit_price,
      staff_id: obs.staff_id || null,
    })
  )
  if (ok) Object.assign(nueva, { service_id: '', description: '', quantity: 1, unit_price: '' })
}

const quitarPrestacion = (i) => ejecutar(() => recepcion.quitarPrestacion(a.value.id, i.id))

// ── 3. Pago ──────────────────────────────────────────────────
const pago = reactive({ method: 'EFECTIVO', amount: '', reference: '' })
watch(
  () => a.value.saldo,
  (saldo) => {
    pago.amount = saldo > 0 ? saldo : ''
  },
  { immediate: true }
)

async function registrarPago() {
  const ok = await ejecutar(() => recepcion.registrarPago(a.value.id, { ...pago }))
  if (ok) pago.reference = ''
}

function quitarPago(p) {
  if (!confirm(`¿Quitar el pago de ${pesos(p.amount)} (${MEDIOS_PAGO[p.method]})?`)) return
  ejecutar(() => recepcion.quitarPago(a.value.id, p.id))
}

// ── 4. Cierre ────────────────────────────────────────────────
const puedeCerrar = computed(() => a.value.items.length > 0 && a.value.saldo <= 0)

function cerrarAtencion() {
  if (obsCambiadas.value && !confirm('Hay observaciones sin guardar. ¿Cerrar igual?')) return
  ejecutar(() => recepcion.cerrar(a.value.id))
}

async function anular() {
  const motivo = prompt('Motivo de la anulación (p. ej. llegada marcada por error):')
  if (motivo === null) return
  if (await ejecutar(() => recepcion.anular(a.value.id, motivo))) emit('cerrar')
}
</script>

<template>
  <ModalDialogo :titulo="`🐾 ${mascota}`" ancho="760px" @cerrar="emit('cerrar')">
    <div class="resumen">
      <div>
        <strong>{{ tutor }}</strong>
        <span v-if="!a.client_id" class="chip gris">Sin ficha</span>
        <div>
          <small class="suave">{{ [a.contact_phone, a.client?.national_id].filter(Boolean).join(' · ') }}</small>
        </div>
      </div>
      <div class="derecha">
        <span class="chip" :class="a.status.toLowerCase()">{{ ESTADOS_ATENCION[a.status] }}</span>
        <div>
          <small class="suave">
            {{ a.appointment ? `Cita ${hhmm(a.appointment.start_time)}` : 'Espontánea' }} · llegó {{ llegada }} ·
            {{ sucursal }}
          </small>
        </div>
      </div>
    </div>

    <ol class="pasos">
      <li v-for="(p, i) in pasos" :key="p.texto" :class="{ listo: p.listo }">
        <span class="numero">{{ p.listo ? '✓' : i + 1 }}</span>{{ p.texto }}
      </li>
    </ol>

    <p v-if="a.status === 'ANULADA'" class="aviso">Atención anulada{{ a.cancel_reason ? `: ${a.cancel_reason}` : '' }}.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <!-- 1. Observaciones -->
    <section class="paso">
      <h3>Observaciones</h3>
      <form class="grilla-form" @submit.prevent="guardarObservaciones">
        <label class="ancho-completo">
          Motivo de consulta, estado al llegar, indicaciones…
          <textarea v-model="obs.observations" rows="3" maxlength="4000" :disabled="!editable"></textarea>
        </label>
        <label>
          Especialidad
          <select v-model="obs.specialty_id" :disabled="!editable">
            <option value="">Sin indicar</option>
            <option v-for="e in opcionesEspecialidad" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
        </label>
        <label>
          Atiende
          <select v-model="obs.staff_id" :disabled="!editable">
            <option value="">Sin asignar</option>
            <option v-for="p in opcionesProfesional" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
          </select>
        </label>
        <div v-if="editable" class="acciones al-pie">
          <button class="secundario" :disabled="ocupado || !obsCambiadas">Guardar observaciones</button>
        </div>
      </form>
    </section>

    <!-- 2. Prestaciones -->
    <section class="paso">
      <h3>Prestaciones</h3>
      <div v-if="a.items.length" class="tabla-contenedor">
        <table class="tabla">
          <thead>
            <tr>
              <th>Servicio</th>
              <th class="num">Cant.</th>
              <th class="num">Precio</th>
              <th class="num">Subtotal</th>
              <th v-if="editable"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in a.items" :key="i.id">
              <td>
                {{ i.description }}
                <div v-if="i.staff_id"><small class="suave">{{ nombre(i.staff_id) }}</small></div>
              </td>
              <td class="num">{{ i.quantity }}</td>
              <td class="num">{{ pesos(i.unit_price) }}</td>
              <td class="num">{{ pesos(i.quantity * i.unit_price) }}</td>
              <td v-if="editable" class="num">
                <button class="peligro pequeno" :disabled="ocupado" @click="quitarPrestacion(i)">Quitar</button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th colspan="3" class="num">Total</th>
              <th class="num">{{ pesos(a.total) }}</th>
              <th v-if="editable"></th>
            </tr>
          </tfoot>
        </table>
      </div>
      <p v-else class="suave">Aún no hay prestaciones cargadas.</p>

      <form v-if="editable" class="fila-form" @submit.prevent="agregarPrestacion">
        <label class="crece">
          Servicio
          <select :value="nueva.service_id" required @change="elegirServicio($event.target.value)">
            <option value="" disabled>Elegir…</option>
            <option v-for="s in serviciosActivos" :key="s.id" :value="s.id">{{ s.name }} · {{ pesos(s.price) }}</option>
            <option :value="LIBRE">Otro (descripción libre)</option>
          </select>
        </label>
        <label v-if="nueva.service_id === LIBRE" class="crece">
          Descripción <input v-model="nueva.description" required maxlength="200" />
        </label>
        <label class="corto">Cant. <input v-model.number="nueva.quantity" type="number" min="1" max="999" required /></label>
        <label class="medio">Precio <input v-model="nueva.unit_price" type="number" min="0" step="1" required /></label>
        <button :disabled="ocupado">Agregar</button>
      </form>
    </section>

    <!-- 3. Pago -->
    <section class="paso">
      <h3>Pago</h3>
      <div class="totales">
        <span>Total <strong>{{ pesos(a.total) }}</strong></span>
        <span>Pagado <strong>{{ pesos(a.pagado) }}</strong></span>
        <span :class="{ pendiente: a.saldo > 0 }">Saldo <strong>{{ pesos(a.saldo) }}</strong></span>
      </div>
      <ul v-if="a.payments.length" class="pagos">
        <li v-for="p in a.payments" :key="p.id">
          <span>
            {{ MEDIOS_PAGO[p.method] }} · <strong>{{ pesos(p.amount) }}</strong>
            <small v-if="p.reference" class="suave"> · ref. {{ p.reference }}</small>
          </span>
          <button v-if="editable" class="peligro pequeno" :disabled="ocupado" @click="quitarPago(p)">Quitar</button>
        </li>
      </ul>
      <form v-if="editable && a.saldo > 0" class="fila-form" @submit.prevent="registrarPago">
        <label class="medio">
          Medio
          <select v-model="pago.method">
            <option v-for="(etiqueta, valor) in MEDIOS_PAGO" :key="valor" :value="valor">{{ etiqueta }}</option>
          </select>
        </label>
        <label class="medio">Monto <input v-model="pago.amount" type="number" min="1" :max="a.saldo" step="1" required /></label>
        <label class="crece">
          Referencia <input v-model="pago.reference" maxlength="80" placeholder="N° voucher / transferencia (opcional)" />
        </label>
        <button :disabled="ocupado">Registrar pago</button>
      </form>
    </section>

    <!-- 4. Cierre -->
    <div v-if="a.status === 'ABIERTA'" class="acciones cierre">
      <button v-if="editable" :disabled="ocupado || !puedeCerrar" @click="cerrarAtencion">Cerrar atención</button>
      <small v-if="editable && !puedeCerrar" class="suave">
        {{ a.items.length ? 'Registra el pago del saldo para cerrar.' : 'Carga al menos una prestación.' }}
      </small>
      <span class="espacio"></span>
      <button v-if="puede('recepcion.eliminar')" class="peligro secundario" :disabled="ocupado" @click="anular">
        Anular llegada
      </button>
    </div>
    <p v-else-if="a.status === 'CERRADA'" class="ok">
      ✓ Atención cerrada a las
      {{ new Date(a.closed_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) }}.
    </p>
  </ModalDialogo>
</template>

<style scoped>
.resumen {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.derecha {
  text-align: right;
}
.pasos {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  flex-wrap: wrap;
}
.pasos li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.85rem;
  color: var(--text-suave);
}
.pasos .numero {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--border);
  font-size: 0.75rem;
  font-weight: 700;
}
.pasos li.listo {
  color: var(--ok);
  border-color: color-mix(in srgb, var(--ok) 40%, transparent);
}
.pasos li.listo .numero {
  background: var(--ok);
  color: #fff;
}
.paso {
  display: grid;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.paso h3 {
  margin: 0;
  font-size: 1rem;
}
.al-pie {
  align-self: end;
}
.fila-form {
  display: flex;
  gap: 8px;
  align-items: end;
  flex-wrap: wrap;
}
.fila-form label {
  display: grid;
  gap: 4px;
  font-size: 0.9rem;
}
.fila-form .crece {
  flex: 1;
  min-width: 180px;
}
.fila-form .corto {
  width: 80px;
}
.fila-form .medio {
  width: 140px;
}
.num {
  text-align: right;
  white-space: nowrap;
}
.totales {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.totales .pendiente strong {
  color: var(--peligro);
}
.pagos {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.pagos li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.cierre {
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.espacio {
  flex: 1;
}
.ok {
  color: var(--ok);
  font-weight: 600;
}
.aviso {
  color: var(--aviso);
}
.chip.abierta {
  background: color-mix(in srgb, var(--aviso) 18%, transparent);
  color: var(--aviso);
}
.chip.cerrada {
  background: color-mix(in srgb, var(--ok) 15%, transparent);
  color: var(--ok);
}
.chip.anulada {
  background: color-mix(in srgb, var(--peligro) 14%, transparent);
  color: var(--peligro);
}
</style>
