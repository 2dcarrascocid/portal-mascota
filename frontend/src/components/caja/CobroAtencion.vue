<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import ModalDialogo from '../ModalDialogo.vue'
import { useCashbox } from '../../composables/useCashbox'
import { pesos } from '../../composables/useReception'
import { ESTADOS_ATENCION, MEDIOS_PAGO } from '../../lib/catalogos'
import { fechaCorta } from '../../lib/fechas'
import { mensajeError } from '../../services/api'

// Cobro de una atención con saldo pendiente desde Pagos y caja: muestra lo
// prestado y lo pagado, y registra pagos (en partes y con varios medios).
// El pago cuenta en la caja de hoy.
const props = defineProps({ atencionId: { type: String, required: true } })
const emit = defineEmits(['cerrar', 'pagado'])

const { obtenerAtencion, registrarPago } = useCashbox()
const a = ref(null)
const error = ref('')
const ocupado = ref(false)
const pago = reactive({ method: 'EFECTIVO', amount: '', reference: '' })

function mostrar(atencion) {
  a.value = atencion
  pago.amount = atencion.saldo > 0 ? atencion.saldo : ''
  pago.reference = ''
}

onMounted(async () => {
  try {
    mostrar(await obtenerAtencion(props.atencionId))
  } catch (err) {
    error.value = mensajeError(err)
  }
})

const titulo = computed(() => (a.value ? `Cobrar · ${a.value.pet?.name || a.value.pet_name || 'Mascota'}` : 'Cobrar'))
const tutor = computed(() =>
  a.value?.client ? `${a.value.client.first_name} ${a.value.client.last_name}` : a.value?.contact_name
)
const cobrable = computed(() => a.value?.status === 'ABIERTA' && a.value.saldo > 0)

async function cobrar() {
  error.value = ''
  ocupado.value = true
  try {
    mostrar(await registrarPago(a.value.id, { ...pago }))
    emit('pagado')
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    ocupado.value = false
  }
}
</script>

<template>
  <ModalDialogo :titulo="titulo" ancho="620px" @cerrar="emit('cerrar')">
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="!a && !error" class="suave">Cargando…</p>

    <template v-if="a">
      <div class="resumen">
        <div>
          <strong>{{ tutor }}</strong>
          <div><small class="suave">{{ a.contact_phone }}</small></div>
        </div>
        <div class="derecha">
          <span class="chip">{{ ESTADOS_ATENCION[a.status] }}</span>
          <div><small class="suave">Atención del {{ fechaCorta(a.date, { anio: true }) }}</small></div>
        </div>
      </div>

      <div class="tabla-contenedor">
        <table class="tabla">
          <thead>
            <tr>
              <th>Prestación</th>
              <th class="num">Cant.</th>
              <th class="num">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in a.items" :key="i.id">
              <td>{{ i.description }}</td>
              <td class="num">{{ i.quantity }}</td>
              <td class="num">{{ pesos(i.quantity * i.unit_price) }}</td>
            </tr>
            <tr v-if="!a.items.length">
              <td colspan="3" class="suave">Sin prestaciones cargadas.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <ul v-if="a.payments.length" class="pagos">
        <li v-for="p in a.payments" :key="p.id">
          {{ MEDIOS_PAGO[p.method] }} · <strong>{{ pesos(p.amount) }}</strong>
          <small class="suave"> · {{ fechaCorta(p.date) }}{{ p.reference ? ` · ref. ${p.reference}` : '' }}</small>
        </li>
      </ul>

      <div class="totales">
        <span>Total <strong>{{ pesos(a.total) }}</strong></span>
        <span>Pagado <strong>{{ pesos(a.pagado) }}</strong></span>
        <span :class="{ pendiente: a.saldo > 0 }">Saldo <strong>{{ pesos(a.saldo) }}</strong></span>
      </div>

      <form v-if="cobrable" class="fila-form" @submit.prevent="cobrar">
        <label class="medio">
          Medio
          <select v-model="pago.method">
            <option v-for="(etiqueta, valor) in MEDIOS_PAGO" :key="valor" :value="valor">{{ etiqueta }}</option>
          </select>
        </label>
        <label class="medio">Monto <input v-model="pago.amount" type="number" min="1" :max="a.saldo" step="1" required /></label>
        <label class="crece">
          Referencia <input v-model="pago.reference" maxlength="80" placeholder="N° voucher, transferencia u orden Webpay" />
        </label>
        <button :disabled="ocupado">Registrar pago</button>
      </form>
      <p v-else-if="a.status === 'ABIERTA' && a.items.length" class="ok">✓ Sin saldo pendiente. Recepción ya puede cerrar la atención.</p>
      <p v-else-if="a.status !== 'ABIERTA'" class="suave">La atención ya no está abierta: no admite pagos.</p>
    </template>
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
.num {
  text-align: right;
  white-space: nowrap;
}
.pagos {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.totales {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.totales .pendiente strong {
  color: var(--peligro);
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
.fila-form .medio {
  width: 150px;
}
.ok {
  color: var(--ok);
  font-weight: 600;
}
</style>
