<script setup>
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePortal } from '../../composables/usePortal'
import { pesos } from '../../composables/useReception'
import { ESTADOS_ATENCION, MEDIOS_PAGO } from '../../lib/catalogos'
import { fechaCorta } from '../../lib/fechas'
import { mensajeError } from '../../services/api'

// Atenciones de las mascotas del tutor en todas las entidades donde se
// atendió (las que registró la recepción con su ficha enlazada).
const route = useRoute()
const router = useRouter()
const { mascotas, cargarMascotas, historial } = usePortal()

const mascota = ref(route.query.mascota || '')
const atenciones = ref([])
const abierta = ref('')
const cargando = ref(true)
const error = ref('')

async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    atenciones.value = await historial(mascota.value ? { tutorPetId: mascota.value } : {})
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
}

onMounted(() => Promise.all([cargarMascotas().catch(() => {}), cargar()]))

watch(mascota, (id) => {
  router.replace({ query: id ? { mascota: id } : {} })
  cargar()
})

const hora = (ts) => (ts ? new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '')
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Historial de atenciones</h1>
      <label v-if="mascotas.length" class="filtro">
        Mascota
        <select v-model="mascota">
          <option value="">Todas</option>
          <option v-for="m in mascotas" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </label>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="cargando" class="suave">Cargando…</p>
    <p v-else-if="!atenciones.length" class="panel vacio">
      Aún no hay atenciones registradas{{ mascota ? ' para esta mascota' : '' }}.
      Aparecerán aquí cuando te atiendas en una sucursal con una reserva hecha desde el portal.
    </p>

    <ul v-else class="lista">
      <li v-for="a in atenciones" :key="a.id" class="panel atencion">
        <button type="button" class="cabecera" :aria-expanded="abierta === a.id" @click="abierta = abierta === a.id ? '' : a.id">
          <span class="fecha">{{ fechaCorta(a.date, { anio: true }) }}</span>
          <span class="titulo">
            <strong>{{ a.pet_name || 'Mascota' }}</strong>
            <span class="suave">
              {{ a.items.map((i) => i.description).join(', ') || a.specialty?.name || 'Atención' }}
            </span>
            <small class="suave">{{ a.organization?.name }} — {{ a.branch?.name }}</small>
          </span>
          <span class="lado">
            <strong>{{ pesos(a.total) }}</strong>
            <span class="chip" :class="{ gris: a.status !== 'ABIERTA' }">{{ ESTADOS_ATENCION[a.status] }}</span>
          </span>
        </button>

        <div v-if="abierta === a.id" class="detalle">
          <dl>
            <dt>Llegada</dt>
            <dd>{{ hora(a.arrived_at) }}</dd>
            <template v-if="a.staff?.full_name">
              <dt>Atendió</dt>
              <dd>{{ a.staff.full_name }}</dd>
            </template>
            <template v-if="a.specialty?.name">
              <dt>Especialidad</dt>
              <dd>{{ a.specialty.name }}</dd>
            </template>
          </dl>
          <div v-if="a.observations" class="observaciones">
            <strong>Observaciones</strong>
            <p>{{ a.observations }}</p>
          </div>
          <table v-if="a.items.length" class="tabla">
            <thead>
              <tr>
                <th>Prestación</th>
                <th>Cant.</th>
                <th>Precio</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(i, n) in a.items" :key="n">
                <td>{{ i.description }}</td>
                <td>{{ i.quantity }}</td>
                <td>{{ pesos(i.quantity * i.unit_price) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th colspan="2">Total</th>
                <th>{{ pesos(a.total) }}</th>
              </tr>
            </tfoot>
          </table>
          <p v-if="a.payments.length" class="suave pagos">
            Pagado: {{ a.payments.map((p) => `${MEDIOS_PAGO[p.method] || p.method} ${pesos(p.amount)}`).join(' · ') }}
            <template v-if="a.saldo > 0"> — saldo {{ pesos(a.saldo) }}</template>
          </p>
        </div>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.filtro {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 0.9rem;
}
.lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.atencion {
  padding: 0;
  overflow: hidden;
}
.cabecera {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  display: grid;
  grid-template-columns: 110px 1fr auto;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
}
.cabecera:focus-visible {
  outline: 2px solid var(--acento);
}
.fecha {
  color: var(--text-suave);
  font-size: 0.9rem;
}
.titulo {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.titulo strong {
  color: var(--text-h);
}
.lado {
  display: grid;
  justify-items: end;
  gap: 4px;
}
.detalle {
  padding: 0 16px 16px;
  display: grid;
  gap: 12px;
  border-top: 1px solid var(--border);
}
.detalle dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 16px;
  margin: 12px 0 0;
  font-size: 0.9rem;
}
.detalle dt {
  color: var(--text-suave);
}
.detalle dd {
  margin: 0;
}
.observaciones p {
  margin: 4px 0 0;
  white-space: pre-line;
}
.pagos {
  margin: 0;
  font-size: 0.9rem;
}
@media (max-width: 600px) {
  .cabecera {
    grid-template-columns: 1fr auto;
  }
  .fecha {
    grid-column: 1 / -1;
  }
}
</style>
