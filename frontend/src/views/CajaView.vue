<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import CobroAtencion from '../components/caja/CobroAtencion.vue'
import { useAuth } from '../composables/useAuth'
import { useBranches } from '../composables/useBranches'
import { useCashbox } from '../composables/useCashbox'
import { pesos } from '../composables/useReception'
import { CATEGORIAS_CAJA, ESTADOS_ATENCION, MEDIOS_PAGO } from '../lib/catalogos'
import { fechaCorta, hoy } from '../lib/fechas'
import { mensajeError } from '../services/api'
import { confirmar } from '../composables/useDialogo'

// Módulo Pagos y caja: resumen de los pagos del día de una sucursal por
// medio de pago (efectivo, tarjetas, internet, otros), pendientes de pago,
// cuadratura contra el arqueo y cierre diario. Con la caja cerrada se
// muestra la foto del cierre y no se admiten pagos de ese día.
const { puede } = useAuth()
const { items: sucursales, cargar: cargarSucursales } = useBranches()
const { caja: datos, cierres, cargando, error, cargar, cargarCierres, cerrar, reabrir } = useCashbox()

// Caja = una sucursal y un día. Por defecto, la (primera) sucursal asignada.
const filtros = reactive({ branchId: '', fecha: hoy() })
const cargadas = ref(false)

onMounted(async () => {
  await cargarSucursales()
  cargadas.value = true
  if (!sucursales.value.some((s) => s.id === filtros.branchId)) filtros.branchId = sucursales.value[0]?.id ?? ''
})
const recargar = () => filtros.branchId && cargar({ branchId: filtros.branchId, fecha: filtros.fecha || hoy() })
watch(() => [filtros.branchId, filtros.fecha], recargar, { immediate: true })
watch(
  () => filtros.branchId,
  (id) => id && cargarCierres({ branchId: id }),
  { immediate: true }
)

// Solo los datos de la caja elegida (el estado del composable puede ser de otra).
const caja = computed(() =>
  datos.value?.branch_id === filtros.branchId && datos.value?.fecha === filtros.fecha ? datos.value : null
)
const resumen = computed(() => caja.value?.resumen)
const cierre = computed(() => caja.value?.cierre)
const esHoy = computed(() => filtros.fecha === (caja.value?.hoy ?? hoy()))
const futuro = computed(() => filtros.fecha > (caja.value?.hoy ?? hoy()))
const sucursal = computed(() => sucursales.value.find((s) => s.id === filtros.branchId)?.name ?? '')

const ocupado = ref(false)
const aviso = ref('')
async function ejecutar(fn) {
  aviso.value = ''
  ocupado.value = true
  try {
    await fn()
    return true
  } catch (err) {
    aviso.value = mensajeError(err)
    return false
  } finally {
    ocupado.value = false
  }
}

const n = (x) => Number(x || 0)
const redondear = (x) => Math.round(x * 100) / 100

// ── Tarjetas de resumen ──────────────────────────────────────
const detalleMedios = (medios) =>
  medios
    .map((m) => ({ medio: m, ...resumen.value.by_method[m] }))
    .filter((d) => d.count)
    .map((d) => `${MEDIOS_PAGO[d.medio]} ${pesos(d.amount)} (${d.count})`)

const tarjetas = computed(() => {
  const r = resumen.value
  if (!r) return []
  return [
    ...CATEGORIAS_CAJA.map((c) => ({
      clave: c.clave,
      texto: c.texto,
      monto: n(r[c.clave]),
      detalle: detalleMedios(c.medios).join(' · ') || 'Sin pagos',
    })),
    { clave: 'total', texto: 'Total recaudado', monto: n(r.total), detalle: `${r.count} pago${r.count === 1 ? '' : 's'}` },
    {
      clave: 'pendiente',
      texto: 'Pendiente de pago',
      monto: n(r.pending_amount),
      detalle: `${r.pending_count} atenci${r.pending_count === 1 ? 'ón' : 'ones'}`,
    },
  ]
})

// ── Cuadratura (sistema vs. arqueo) ──────────────────────────
const arqueo = reactive({ opening_cash: '', cash_counted: '', card_counted: '', online_counted: '', other_counted: '', notes: '' })
const valor = (x) => (x === '' || x == null ? null : Number(x))
watch(() => [filtros.branchId, filtros.fecha], () => Object.keys(arqueo).forEach((k) => (arqueo[k] = '')))

const fondo = computed(() => (cierre.value ? n(cierre.value.opening_cash) : valor(arqueo.opening_cash) ?? 0))

const cuadratura = computed(() => {
  const r = resumen.value
  if (!r) return []
  const c = cierre.value
  return CATEGORIAS_CAJA.map((cat) => {
    const campo = `${cat.clave}_counted`
    const sistema = c ? n(c[`${cat.clave}_expected`]) : n(r[cat.clave]) + (cat.clave === 'cash' ? fondo.value : 0)
    const declarado = c ? (c[campo] == null ? null : n(c[campo])) : valor(arqueo[campo])
    return {
      ...cat,
      campo,
      sistema,
      declarado,
      diferencia: declarado == null ? null : redondear(declarado - sistema),
      nota: cat.clave === 'cash' ? `Fondo ${pesos(fondo.value)} + recibido ${pesos(r.cash)}` : '',
    }
  })
})
const totalCuadratura = computed(() => {
  const declaradas = cuadratura.value.filter((f) => f.declarado != null)
  return {
    sistema: redondear(cuadratura.value.reduce((s, f) => s + f.sistema, 0)),
    declarado: declaradas.length ? redondear(declaradas.reduce((s, f) => s + f.declarado, 0)) : null,
    diferencia: declaradas.length ? redondear(declaradas.reduce((s, f) => s + f.diferencia, 0)) : null,
  }
})
const claseDiferencia = (d) => (d == null ? '' : d === 0 ? 'cuadra' : d > 0 ? 'sobra' : 'falta')
const textoDiferencia = (d) => (d == null ? '—' : d === 0 ? 'Cuadra' : `${d > 0 ? 'Sobra' : 'Falta'} ${pesos(Math.abs(d))}`)

const puedeCerrar = computed(() => !!resumen.value && !cierre.value && !futuro.value && puede('caja.crear'))

async function cerrarCaja() {
  const avisos = []
  const sinDeclarar = cuadratura.value.filter((f) => f.declarado == null && f.sistema > 0).map((f) => f.texto)
  if (sinDeclarar.length) avisos.push(`Sin arqueo declarado: ${sinDeclarar.join(', ')}.`)
  const descuadre = totalCuadratura.value.diferencia
  if (descuadre) avisos.push(`La caja no cuadra: ${textoDiferencia(descuadre).toLowerCase()}.`)
  if (resumen.value.pending_count) {
    avisos.push(`Quedan ${resumen.value.pending_count} atenciones con saldo pendiente (${pesos(resumen.value.pending_amount)}).`)
  }
  const texto = `¿Cerrar la caja de ${sucursal.value} del ${fechaCorta(filtros.fecha, { anio: true })}?`
  const detalle = [...avisos, 'Después no se podrán agregar ni quitar pagos de ese día.']
  if (!(await confirmar({ titulo: 'Cerrar caja', mensaje: texto, detalle, aceptar: 'Cerrar caja' }))) return

  const ok = await ejecutar(() => cerrar({ branch_id: filtros.branchId, date: filtros.fecha, ...arqueo }))
  if (ok) cargarCierres({ branchId: filtros.branchId })
}

async function reabrirCaja() {
  const mensaje = '¿Reabrir la caja? Se descarta el cierre y el arqueo registrados; habrá que cerrarla de nuevo.'
  if (!(await confirmar({ titulo: 'Reabrir caja', mensaje, aceptar: 'Reabrir', peligro: true }))) return
  const ok = await ejecutar(() => reabrir(cierre.value.id))
  if (ok) cargarCierres({ branchId: filtros.branchId })
}

const imprimir = () => window.print()

const horaDe = (iso) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const fechaHora = (iso) => `${fechaCorta(iso.slice(0, 10))} ${horaDe(iso)}`

// ── Pestañas: cuadratura | pagos | pendientes ────────────────
const pestana = ref('cuadratura')

// Pagos del día (filtro por medio y paginación).
const medio = ref('')
const pagos = computed(() => (caja.value?.pagos ?? []).filter((p) => !medio.value || p.method === medio.value))
const POR_PAGINA = 15
const pagina = ref(1)
const totalPaginas = computed(() => Math.max(1, Math.ceil(pagos.value.length / POR_PAGINA)))
const enPagina = computed(() => pagos.value.slice((pagina.value - 1) * POR_PAGINA, pagina.value * POR_PAGINA))
watch([medio, () => filtros.branchId, () => filtros.fecha], () => (pagina.value = 1))
const mascotaDe = (visit) => visit?.pet?.name || visit?.pet_name || 'Mascota'

// Pendientes: se cobran hoy (el pago entra en la caja del día).
const pendientes = computed(() => resumen.value?.pending ?? [])
const cobrando = ref(null)
const puedeCobrar = computed(
  () => esHoy.value && !cierre.value && (puede('recepcion.editar') || puede('caja.editar'))
)
</script>

<template>
  <main class="contenedor pagina ancha">
    <div class="pagina-cabecera">
      <h1>Pagos y caja</h1>
      <div class="acciones no-imprimir">
        <button v-if="resumen" class="secundario" @click="imprimir">Imprimir</button>
      </div>
    </div>

    <p v-if="cargadas && !sucursales.length" class="panel aviso">
      No tienes una sucursal asignada. Pide al administrador que te asigne a una en Configuración › Personal.
    </p>

    <div v-else class="dividida">
      <!-- Izquierda: caja (sucursal + día) e historial de cierres -->
      <aside class="panel filtros-lateral no-imprimir" aria-label="Caja">
        <label>
          Sucursal
          <select v-model="filtros.branchId">
            <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label>
          Día
          <span class="fecha">
            <input v-model="filtros.fecha" type="date" required :max="caja?.hoy ?? hoy()" />
            <button v-if="!esHoy" type="button" class="secundario pequeno" @click="filtros.fecha = hoy()">Hoy</button>
          </span>
        </label>

        <div v-if="caja" class="estado-caja" :class="cierre ? 'cerrada' : 'abierta'">
          <strong>{{ cierre ? '🔒 Caja cerrada' : '🟢 Caja abierta' }}</strong>
          <small v-if="cierre">
            {{ fechaHora(cierre.closed_at) }}{{ cierre.cerrado_por?.full_name ? ` · ${cierre.cerrado_por.full_name}` : '' }}
          </small>
          <small v-else-if="!esHoy">Día anterior sin cerrar</small>
        </div>

        <div v-if="cierres.length" class="historial">
          <h3>Últimos cierres</h3>
          <ul>
            <li v-for="c in cierres.slice(0, 10)" :key="c.id">
              <button
                type="button"
                class="secundario pequeno"
                :class="{ activo: c.date === filtros.fecha }"
                @click="filtros.fecha = c.date"
              >
                <span>{{ fechaCorta(c.date) }}</span>
                <span>{{ pesos(c.total_collected) }}</span>
              </button>
            </li>
          </ul>
        </div>
      </aside>

      <!-- Derecha: resumen, cuadratura, pagos y pendientes -->
      <section class="panel resultados">
        <header class="cabecera">
          <h2>{{ sucursal }} · {{ fechaCorta(filtros.fecha, { anio: true }) }}</h2>
          <span v-if="cargando" class="suave">Cargando…</span>
        </header>

        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="aviso" class="error" role="alert">{{ aviso }}</p>

        <template v-if="resumen">
          <p v-if="cierre" class="suave nota">
            Foto tomada al cerrar la caja. Los pagos de este día ya no se pueden modificar.
          </p>

          <div class="tarjetas">
            <article v-for="t in tarjetas" :key="t.clave" class="tarjeta" :class="t.clave">
              <span class="titulo">{{ t.texto }}</span>
              <strong>{{ pesos(t.monto) }}</strong>
              <small class="suave">{{ t.detalle }}</small>
            </article>
          </div>

          <div class="acciones pestanas no-imprimir" role="tablist" aria-label="Detalle">
            <button
              v-for="p in [
                { clave: 'cuadratura', texto: 'Cuadratura y cierre' },
                { clave: 'pagos', texto: 'Pagos', cuenta: caja.pagos.length },
                { clave: 'pendientes', texto: 'Pendientes', cuenta: pendientes.length },
              ]"
              :key="p.clave"
              role="tab"
              :aria-selected="pestana === p.clave"
              class="pequeno"
              :class="{ secundario: pestana !== p.clave }"
              @click="pestana = p.clave"
            >
              {{ p.texto }} <span v-if="p.cuenta != null" class="contador">{{ p.cuenta }}</span>
            </button>
          </div>

          <!-- Cuadratura y cierre -->
          <div v-show="pestana === 'cuadratura'" class="bloque">
            <div class="tabla-contenedor">
              <table class="tabla">
                <thead>
                  <tr>
                    <th>Medio</th>
                    <th class="num">Sistema</th>
                    <th class="num">Arqueo</th>
                    <th class="num">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="f in cuadratura" :key="f.clave">
                    <td>
                      {{ f.texto }}
                      <div v-if="f.nota"><small class="suave">{{ f.nota }}</small></div>
                    </td>
                    <td class="num">{{ pesos(f.sistema) }}</td>
                    <td class="num">
                      <input
                        v-if="!cierre"
                        v-model="arqueo[f.campo]"
                        type="number"
                        min="0"
                        step="1"
                        class="monto"
                        :aria-label="`${f.texto} contado`"
                        placeholder="—"
                      />
                      <template v-else>{{ f.declarado == null ? '—' : pesos(f.declarado) }}</template>
                    </td>
                    <td class="num" :class="claseDiferencia(f.diferencia)">{{ textoDiferencia(f.diferencia) }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th class="num">{{ pesos(totalCuadratura.sistema) }}</th>
                    <th class="num">{{ totalCuadratura.declarado == null ? '—' : pesos(totalCuadratura.declarado) }}</th>
                    <th class="num" :class="claseDiferencia(totalCuadratura.diferencia)">
                      {{ textoDiferencia(totalCuadratura.diferencia) }}
                    </th>
                  </tr>
                </tfoot>
              </table>
            </div>

            <form v-if="!cierre" class="grilla-form" @submit.prevent="cerrarCaja">
              <label>
                Fondo inicial (sencillo)
                <input v-model="arqueo.opening_cash" type="number" min="0" step="1" placeholder="0" :disabled="!puedeCerrar" />
              </label>
              <label class="ancho-completo">
                Observaciones del cierre
                <textarea v-model="arqueo.notes" rows="2" maxlength="1000" :disabled="!puedeCerrar"></textarea>
              </label>
              <div class="acciones ancho-completo no-imprimir">
                <button v-if="puede('caja.crear')" :disabled="ocupado || !puedeCerrar">Cerrar caja del día</button>
                <small v-if="futuro" class="suave">No se puede cerrar un día futuro.</small>
                <small v-else-if="!puede('caja.crear')" class="suave">Tu rol puede consultar la caja, pero no cerrarla.</small>
              </div>
            </form>
            <div v-else class="cierre-info">
              <p v-if="cierre.notes"><strong>Observaciones:</strong> {{ cierre.notes }}</p>
              <p class="suave">
                {{ cierre.payments_count }} pagos · pendiente al cierre {{ pesos(cierre.pending_amount) }}
                ({{ cierre.pending_count }} atenciones) · cerrada {{ fechaHora(cierre.closed_at) }}
                {{ cierre.cerrado_por?.full_name ? `por ${cierre.cerrado_por.full_name}` : '' }}
              </p>
              <div class="acciones no-imprimir">
                <button v-if="puede('caja.eliminar')" class="peligro secundario" :disabled="ocupado" @click="reabrirCaja">
                  Reabrir caja
                </button>
              </div>
            </div>
          </div>

          <!-- Pagos del día -->
          <div v-show="pestana === 'pagos'" class="bloque">
            <label class="filtro-medio no-imprimir">
              Medio
              <select v-model="medio">
                <option value="">Todos</option>
                <option v-for="(etiqueta, m) in MEDIOS_PAGO" :key="m" :value="m">{{ etiqueta }}</option>
              </select>
            </label>
            <p v-if="!pagos.length" class="vacio">No hay pagos registrados{{ medio ? ' con ese medio' : '' }}.</p>
            <div v-else class="tabla-contenedor">
              <table class="tabla">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Atención</th>
                    <th>Medio</th>
                    <th>Referencia</th>
                    <th>Registró</th>
                    <th class="num">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in enPagina" :key="p.id">
                    <td>{{ horaDe(p.created_at) }}</td>
                    <td>
                      🐾 {{ mascotaDe(p.visit) }}
                      <div><small class="suave">{{ p.visit?.contact_name }}</small></div>
                      <div v-if="p.visit && p.visit.date !== filtros.fecha">
                        <small class="suave">Atención del {{ fechaCorta(p.visit.date) }}</small>
                      </div>
                    </td>
                    <td>{{ MEDIOS_PAGO[p.method] ?? p.method }}</td>
                    <td>{{ p.reference || '—' }}</td>
                    <td><small>{{ p.registrado?.full_name || '—' }}</small></td>
                    <td class="num"><strong>{{ pesos(p.amount) }}</strong></td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <th colspan="5" class="num">Total{{ medio ? ` ${MEDIOS_PAGO[medio]}` : '' }}</th>
                    <th class="num">{{ pesos(pagos.reduce((s, p) => s + n(p.amount), 0)) }}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
            <nav v-if="totalPaginas > 1" class="paginador no-imprimir" aria-label="Páginas">
              <button type="button" class="secundario pequeno" :disabled="pagina === 1" @click="pagina--">‹ Anterior</button>
              <span>Página {{ pagina }} de {{ totalPaginas }}</span>
              <button type="button" class="secundario pequeno" :disabled="pagina === totalPaginas" @click="pagina++">
                Siguiente ›
              </button>
            </nav>
          </div>

          <!-- Pendientes de pago -->
          <div v-show="pestana === 'pendientes'" class="bloque">
            <p class="suave nota">
              Atenciones de esta sucursal, de este día o anteriores, con saldo por pagar{{ cierre ? ' al momento del cierre' : '' }}.
              <template v-if="!esHoy && !cierre">Los cobros se registran en la caja de hoy.</template>
            </p>
            <p v-if="!pendientes.length" class="vacio">No hay pagos pendientes. 🎉</p>
            <div v-else class="tabla-contenedor">
              <table class="tabla">
                <thead>
                  <tr>
                    <th>Atención</th>
                    <th>Tutor</th>
                    <th class="num">Total</th>
                    <th class="num">Pagado</th>
                    <th class="num">Saldo</th>
                    <th v-if="puedeCobrar" class="no-imprimir"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in pendientes" :key="p.visit_id">
                    <td>
                      🐾 {{ p.pet_name || 'Mascota' }}
                      <div><small class="suave">{{ fechaCorta(p.date) }}</small></div>
                    </td>
                    <td>{{ p.contact_name }}</td>
                    <td class="num">{{ pesos(p.total) }}</td>
                    <td class="num">{{ pesos(p.paid) }}</td>
                    <td class="num falta"><strong>{{ pesos(p.balance) }}</strong></td>
                    <td v-if="puedeCobrar" class="num no-imprimir">
                      <button class="pequeno" @click="cobrando = p.visit_id">Cobrar</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
        <p v-else-if="!cargando && !error && filtros.branchId" class="vacio">Sin datos para esta caja.</p>
      </section>
    </div>

    <CobroAtencion v-if="cobrando" :atencion-id="cobrando" @cerrar="cobrando = null" @pagado="recargar" />
  </main>
</template>

<style scoped>
/* Dos columnas, como Recepción: caja | detalle. */
.ancha {
  width: min(100%, 1180px);
}
.dividida {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
}
.filtros-lateral {
  display: grid;
  gap: 12px;
  align-content: start;
}
.filtros-lateral label {
  display: grid;
  gap: 4px;
  font-size: 0.85rem;
  min-width: 0;
}
.filtros-lateral input,
.filtros-lateral select {
  width: 100%;
  min-width: 0;
}
.fecha {
  display: flex;
  gap: 6px;
  align-items: center;
}
.estado-caja {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.9rem;
}
.estado-caja.abierta {
  background: color-mix(in srgb, var(--ok) 12%, transparent);
  color: var(--ok);
}
.estado-caja.cerrada {
  background: var(--acento-bg);
  color: var(--acento);
}
.estado-caja small {
  color: var(--text-suave);
}
.historial h3 {
  margin: 0 0 6px;
  font-size: 0.85rem;
  color: var(--text-suave);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.historial ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.historial button {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.historial button.activo {
  border-color: var(--acento);
  color: var(--acento);
}
.resultados {
  display: grid;
  gap: 14px;
  align-content: start;
  min-width: 0;
}
.cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.cabecera h2 {
  margin: 0;
  font-size: 1.05rem;
}
.resultados p {
  margin: 0;
}
.nota {
  font-size: 0.85rem;
}
.tarjetas {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
.tarjeta {
  display: grid;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  min-width: 0;
}
.tarjeta .titulo {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-suave);
}
.tarjeta strong {
  font-size: 1.3rem;
  color: var(--text-h);
  font-variant-numeric: tabular-nums;
}
.tarjeta small {
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}
.tarjeta.total {
  border-color: var(--acento);
  background: var(--acento-bg);
}
.tarjeta.pendiente strong {
  color: var(--peligro);
}
.pestanas {
  border-bottom: 1px solid var(--border);
  padding-bottom: 10px;
}
.contador {
  margin-left: 4px;
  font-size: 0.75rem;
  font-weight: 700;
}
.bloque {
  display: grid;
  gap: 12px;
}
.num {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.monto {
  width: 130px;
  text-align: right;
}
.cuadra {
  color: var(--ok);
  font-weight: 600;
}
.sobra {
  color: var(--aviso);
  font-weight: 600;
}
.falta {
  color: var(--peligro);
  font-weight: 600;
}
.filtro-medio {
  display: grid;
  gap: 4px;
  font-size: 0.85rem;
  width: 220px;
}
.cierre-info {
  display: grid;
  gap: 8px;
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
.aviso {
  color: var(--aviso);
  margin: 0;
}
@media (max-width: 760px) {
  .dividida {
    grid-template-columns: 1fr;
  }
}
@media print {
  .ancha {
    width: 100%;
  }
  .dividida {
    grid-template-columns: 1fr;
  }
  /* Al imprimir se muestra todo el detalle, no solo la pestaña activa. */
  .bloque {
    display: grid !important;
  }
}
</style>
