<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { confirmar } from '../../composables/useDialogo'
import { usePortal } from '../../composables/usePortal'
import { pesos } from '../../composables/useReception'
import { ESTADOS_CITA } from '../../lib/catalogos'
import { fechaCorta, hhmm, hoy } from '../../lib/fechas'
import { irAWebpay } from '../../lib/webpay'
import { mensajeError } from '../../services/api'

const route = useRoute()
const { listarCitas, pagarCita, cancelarCita } = usePortal()

const citas = ref([])
const cargando = ref(true)
const error = ref('')
const ocupada = ref('') // id de la cita con una acción en curso
const aviso = ref(route.query.reservada ? 'Tu reserva quedó registrada.' : '')

async function cargar() {
  error.value = ''
  try {
    citas.value = await listarCitas()
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
}
onMounted(cargar)

const vigente = (c) => c.date >= hoy() && ['RESERVADA', 'CONFIRMADA', 'LLEGO'].includes(c.status)
const proximas = computed(() =>
  citas.value.filter(vigente).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))
)
const anteriores = computed(() => citas.value.filter((c) => !vigente(c)))

const horaLimite = (c) =>
  c.payment_expires_at ? new Date(c.payment_expires_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : ''
const cancelable = (c) => ['RESERVADA', 'CONFIRMADA'].includes(c.status) && c.date >= hoy() && c.payment_status !== 'PAGADO'

async function pagar(c) {
  ocupada.value = c.id
  error.value = ''
  try {
    irAWebpay(await pagarCita(c.id))
  } catch (err) {
    error.value = mensajeError(err)
    ocupada.value = ''
    cargar()
  }
}

async function cancelar(c) {
  const ok = await confirmar({
    titulo: '¿Cancelar la cita?',
    mensaje: `${c.service?.name || 'Cita'} para ${c.pet?.name || 'tu mascota'}, ${fechaCorta(c.date)} a las ${hhmm(c.start_time)}.`,
    detalle: 'El horario queda libre para otras personas.',
    aceptar: 'Cancelar cita',
    peligro: true,
  })
  if (!ok) return
  ocupada.value = c.id
  error.value = ''
  try {
    const actualizada = await cancelarCita(c.id)
    citas.value = citas.value.map((x) => (x.id === c.id ? actualizada : x))
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    ocupada.value = ''
  }
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Mis citas</h1>
      <button @click="$router.push({ name: 'mi-reservar' })">+ Reservar hora</button>
    </div>

    <p v-if="aviso" class="ok" role="status">✓ {{ aviso }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="cargando" class="suave">Cargando…</p>

    <template v-else>
      <section class="panel">
        <h2>Próximas</h2>
        <p v-if="!proximas.length" class="vacio">No tienes citas próximas.</p>
        <ul v-else class="lista">
          <li v-for="c in proximas" :key="c.id" class="cita">
            <div class="cuando">
              <strong>{{ fechaCorta(c.date) }}</strong>
              <span>{{ hhmm(c.start_time) }}</span>
            </div>
            <div class="datos">
              <strong>{{ c.service?.name || 'Atención' }} · {{ c.pet?.name || 'Mascota' }}</strong>
              <span class="suave">{{ c.organization?.name }} — {{ c.branch?.name }}</span>
              <small class="suave">
                {{ [c.branch?.address, c.branch?.city].filter(Boolean).join(', ') }}
                <template v-if="c.staff?.full_name"> · con {{ c.staff.full_name }}</template>
              </small>
              <div class="chips">
                <span class="chip" :class="{ gris: c.status !== 'CONFIRMADA' }">{{ ESTADOS_CITA[c.status] }}</span>
                <span v-if="c.payment_status === 'PAGADO'" class="chip pagado">Pagado {{ pesos(c.payment_amount) }}</span>
                <span v-else-if="c.payment_status === 'PENDIENTE'" class="chip pendiente">
                  Pago pendiente · hasta las {{ horaLimite(c) }}
                </span>
              </div>
            </div>
            <div class="acciones">
              <button v-if="c.payment_status === 'PENDIENTE'" class="pequeno" :disabled="ocupada === c.id" @click="pagar(c)">
                Pagar {{ pesos(c.payment_amount) }}
              </button>
              <button v-if="cancelable(c)" class="peligro pequeno" :disabled="ocupada === c.id" @click="cancelar(c)">
                Cancelar
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section class="panel">
        <h2>Anteriores y canceladas</h2>
        <p v-if="!anteriores.length" class="vacio">Sin citas anteriores.</p>
        <div v-else class="tabla-contenedor">
          <table class="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Servicio</th>
                <th>Mascota</th>
                <th>Lugar</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in anteriores" :key="c.id">
                <td>{{ fechaCorta(c.date, { anio: true }) }} {{ hhmm(c.start_time) }}</td>
                <td>{{ c.service?.name || '—' }}</td>
                <td>{{ c.pet?.name || '—' }}</td>
                <td>{{ c.organization?.name }} — {{ c.branch?.name }}</td>
                <td>
                  <span class="chip gris">{{ ESTADOS_CITA[c.status] }}</span>
                  <small v-if="c.cancel_reason" class="suave motivo">{{ c.cancel_reason }}</small>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.ok {
  color: var(--ok);
  margin: 0;
}
.lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.cita {
  display: grid;
  grid-template-columns: 90px 1fr auto;
  gap: 12px;
  align-items: start;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.cuando {
  display: grid;
  text-align: center;
  padding: 6px;
  border-radius: 8px;
  background: var(--acento-bg);
  color: var(--acento);
  text-transform: capitalize;
}
.datos {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.datos .chips {
  margin-top: 4px;
}
.chip.pagado {
  background: rgba(47, 158, 91, 0.15);
  color: var(--ok);
}
.chip.pendiente {
  background: rgba(217, 154, 30, 0.18);
  color: var(--aviso);
}
.motivo {
  display: block;
  font-size: 0.8rem;
}
@media (max-width: 600px) {
  .cita {
    grid-template-columns: 70px 1fr;
  }
  .cita .acciones {
    grid-column: 1 / -1;
  }
}
</style>
