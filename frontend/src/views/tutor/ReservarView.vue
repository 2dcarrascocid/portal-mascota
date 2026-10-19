<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePortal } from '../../composables/usePortal'
import { pesos } from '../../composables/useReception'
import { CATEGORIAS_SERVICIO } from '../../lib/catalogos'
import { fechaCorta, hoy, sumarDias } from '../../lib/fechas'
import { irAWebpay } from '../../lib/webpay'
import { mensajeError } from '../../services/api'

// Reserva de una hora: sucursal -> servicio -> mascota -> horario -> pago.
const route = useRoute()
const router = useRouter()
const { perfilCompleto, mascotas, cargarPerfil, cargarMascotas, buscarSucursales, obtenerSucursal, disponibles, reservar } =
  usePortal()

const DIAS_VISTA = 7

const cargando = ref(true)
const error = ref('')

const sucursales = ref([])
const sucursalId = ref(route.query.sucursal || '')
const sucursal = ref(null)
const servicios = ref([])
const servicioId = ref('')
const mascotaId = ref(route.query.mascota || '')

const desde = ref(hoy())
const dias = ref([])
const profesionales = ref({})
const profesional = ref('') // filtro opcional
const buscandoHoras = ref(false)
const errorHoras = ref('')
const turno = ref(null) // { fecha, staff_id, inicio, fin }
const notas = ref('')
const enviando = ref(false)

onMounted(async () => {
  try {
    const [, , cercanas] = await Promise.all([cargarPerfil(), cargarMascotas(), buscarSucursales()])
    sucursales.value = cercanas.sucursales
    if (!mascotaId.value && mascotas.value.length === 1) mascotaId.value = mascotas.value[0].id
    if (!sucursalId.value && sucursales.value.length) sucursalId.value = sucursales.value[0].id
    // La sucursal del enlace puede no estar entre las cercanas.
    if (sucursalId.value) await cargarSucursal(sucursalId.value)
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
})

async function cargarSucursal(id) {
  sucursal.value = null
  servicios.value = []
  servicioId.value = ''
  if (!id) return
  try {
    const data = await obtenerSucursal(id)
    sucursal.value = data.sucursal
    servicios.value = data.servicios
    if (!sucursales.value.some((s) => s.id === id)) sucursales.value = [data.sucursal, ...sucursales.value]
    if (servicios.value.length === 1) servicioId.value = servicios.value[0].id
  } catch (err) {
    error.value = mensajeError(err)
  }
}

watch(sucursalId, (id) => {
  if (!cargando.value) cargarSucursal(id)
})

const servicio = computed(() => servicios.value.find((s) => s.id === servicioId.value) ?? null)
const mascota = computed(() => mascotas.value.find((m) => m.id === mascotaId.value) ?? null)
const serviciosPorCategoria = computed(() => {
  const grupos = {}
  for (const s of servicios.value) (grupos[s.category] ??= []).push(s)
  return grupos
})

async function buscarHoras() {
  turno.value = null
  dias.value = []
  errorHoras.value = ''
  if (!sucursalId.value || !servicioId.value) return
  buscandoHoras.value = true
  try {
    const data = await disponibles({
      branchId: sucursalId.value,
      serviceId: servicioId.value,
      desde: desde.value,
      hasta: sumarDias(desde.value, DIAS_VISTA - 1),
    })
    dias.value = data.dias
    profesionales.value = data.profesionales
    if (profesional.value && !data.profesionales[profesional.value]) profesional.value = ''
  } catch (err) {
    errorHoras.value = mensajeError(err)
  } finally {
    buscandoHoras.value = false
  }
}

watch([servicioId, desde], buscarHoras)

// Días con horas, agrupadas por profesional (y filtradas si se eligió uno).
const diasConHoras = computed(() =>
  dias.value
    .map((d) => ({
      ...d,
      agendas: d.agendas.filter((a) => a.turnos.length && (!profesional.value || a.staff_id === profesional.value)),
    }))
    .filter((d) => d.agendas.length)
)

const puedeRetroceder = computed(() => desde.value > hoy())
function moverSemana(dir) {
  const nueva = sumarDias(desde.value, dir * DIAS_VISTA)
  desde.value = nueva < hoy() ? hoy() : nueva
}

const elegido = (fecha, staffId, t) =>
  turno.value?.fecha === fecha && turno.value?.staff_id === staffId && turno.value?.inicio === t.inicio

const listo = computed(() => perfilCompleto.value && sucursal.value && servicio.value && mascota.value && turno.value)

async function confirmarReserva() {
  error.value = ''
  enviando.value = true
  try {
    const { cita, pago } = await reservar({
      branch_id: sucursal.value.id,
      service_id: servicio.value.id,
      staff_id: turno.value.staff_id,
      date: turno.value.fecha,
      start_time: turno.value.inicio,
      tutor_pet_id: mascota.value.id,
      notes: notas.value,
    })
    if (pago) {
      irAWebpay(pago) // la página se va a Webpay
      return
    }
    router.push({ name: 'mi-citas', query: { reservada: cita.id } })
  } catch (err) {
    error.value = mensajeError(err)
    // El horario pudo haberse tomado: se actualiza la grilla.
    if (err.response?.status === 409) buscarHoras()
    enviando.value = false
  }
}

const distancia = (km) => (km == null ? '' : km < 1 ? ` · ${Math.round(km * 1000)} m` : ` · ${km.toFixed(1)} km`)
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Reservar hora</h1>
    </div>

    <p v-if="cargando" class="suave">Cargando…</p>
    <template v-else>
      <p v-if="!perfilCompleto" class="panel aviso">
        Antes de reservar, <RouterLink :to="{ name: 'mi-perfil' }">completa tu perfil</RouterLink> con tus nombres y apellidos.
      </p>

      <!-- 1. Sucursal -->
      <section class="panel">
        <h2><span class="paso">1</span> Sucursal</h2>
        <p v-if="!sucursales.length" class="vacio">No hay sucursales disponibles.</p>
        <template v-else>
          <select v-model="sucursalId" aria-label="Sucursal">
            <option value="" disabled>Elegir sucursal…</option>
            <option v-for="s in sucursales" :key="s.id" :value="s.id">
              {{ s.organization?.name }} — {{ s.name }}{{ distancia(s.distancia_km) }}
            </option>
          </select>
          <p v-if="sucursal" class="suave detalle">
            {{ [sucursal.address, sucursal.city].filter(Boolean).join(', ') }}
            <template v-if="sucursal.phone"> · ☎ {{ sucursal.phone }}</template>
          </p>
          <RouterLink :to="{ name: 'mi-sucursales' }" class="pequeno">Ver sucursales en el mapa</RouterLink>
        </template>
      </section>

      <!-- 2. Servicio -->
      <section v-if="sucursal" class="panel">
        <h2><span class="paso">2</span> Servicio</h2>
        <p v-if="!servicios.length" class="vacio">Esta sucursal no tiene servicios para reservar en línea.</p>
        <div v-for="(lista, categoria) in serviciosPorCategoria" :key="categoria" class="grupo">
          <h3>{{ CATEGORIAS_SERVICIO[categoria] || categoria }}</h3>
          <div class="opciones">
            <label v-for="s in lista" :key="s.id" class="opcion" :class="{ elegida: s.id === servicioId }">
              <input v-model="servicioId" type="radio" name="servicio" :value="s.id" />
              <span class="texto">
                <strong>{{ s.name }}</strong>
                <small v-if="s.description" class="suave">{{ s.description }}</small>
                <small class="suave">{{ s.duration_minutes }} min</small>
              </span>
              <span class="precio">{{ s.price > 0 ? pesos(s.price) : 'Sin costo' }}</span>
            </label>
          </div>
        </div>
      </section>

      <!-- 3. Mascota -->
      <section v-if="servicio" class="panel">
        <h2><span class="paso">3</span> Mascota</h2>
        <p v-if="!mascotas.length" class="vacio">
          No tienes mascotas registradas. <RouterLink :to="{ name: 'mi-mascotas' }">Agrega una</RouterLink>
        </p>
        <div v-else class="chips">
          <label v-for="m in mascotas" :key="m.id" class="opcion compacta" :class="{ elegida: m.id === mascotaId }">
            <input v-model="mascotaId" type="radio" name="mascota" :value="m.id" />
            {{ m.name }}
          </label>
        </div>
      </section>

      <!-- 4. Horario -->
      <section v-if="servicio && mascota" class="panel">
        <h2><span class="paso">4</span> Día y hora</h2>
        <div class="filtros barra-horas">
          <button class="secundario pequeno" :disabled="!puedeRetroceder || buscandoHoras" @click="moverSemana(-1)">‹ Anterior</button>
          <strong>{{ fechaCorta(desde) }} – {{ fechaCorta(sumarDias(desde, DIAS_VISTA - 1)) }}</strong>
          <button class="secundario pequeno" :disabled="buscandoHoras" @click="moverSemana(1)">Siguiente ›</button>
          <label v-if="Object.keys(profesionales).length > 1">
            Profesional
            <select v-model="profesional">
              <option value="">Cualquiera</option>
              <option v-for="(nombre, id) in profesionales" :key="id" :value="id">{{ nombre }}</option>
            </select>
          </label>
        </div>

        <p v-if="buscandoHoras" class="suave">Buscando horas disponibles…</p>
        <p v-else-if="errorHoras" class="error" role="alert">{{ errorHoras }}</p>
        <p v-else-if="!diasConHoras.length" class="vacio">No hay horas disponibles en estos días. Prueba la semana siguiente.</p>
        <div v-else class="dias">
          <div v-for="d in diasConHoras" :key="d.fecha" class="dia">
            <h3>{{ fechaCorta(d.fecha) }}</h3>
            <div v-for="a in d.agendas" :key="a.staff_id" class="agenda">
              <small class="suave">{{ profesionales[a.staff_id] }}</small>
              <div class="turnos">
                <button
                  v-for="t in a.turnos"
                  :key="t.inicio"
                  type="button"
                  class="pequeno"
                  :class="{ secundario: !elegido(d.fecha, a.staff_id, t) }"
                  :aria-pressed="elegido(d.fecha, a.staff_id, t)"
                  @click="turno = { fecha: d.fecha, staff_id: a.staff_id, inicio: t.inicio, fin: t.fin }"
                >
                  {{ t.inicio }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 5. Confirmación y pago -->
      <section v-if="turno" class="panel resumen">
        <h2><span class="paso">5</span> Confirmar</h2>
        <dl>
          <dt>Servicio</dt>
          <dd>{{ servicio.name }}</dd>
          <dt>Mascota</dt>
          <dd>{{ mascota.name }}</dd>
          <dt>Cuándo</dt>
          <dd>{{ fechaCorta(turno.fecha, { anio: true }) }}, {{ turno.inicio }} – {{ turno.fin }}</dd>
          <dt>Con</dt>
          <dd>{{ profesionales[turno.staff_id] }}</dd>
          <dt>Dónde</dt>
          <dd>{{ sucursal.organization?.name }} — {{ sucursal.name }}</dd>
          <dt>Total</dt>
          <dd class="total">{{ servicio.price > 0 ? pesos(servicio.price) : 'Sin costo' }}</dd>
        </dl>
        <label class="campo">
          Comentarios para la sucursal (opcional)
          <textarea v-model="notas" rows="2" maxlength="1000" placeholder="Ej: es muy nervioso con otros perros"></textarea>
        </label>
        <p v-if="servicio.price > 0" class="suave nota">
          Pagarás con Webpay (tarjeta de débito o crédito). El horario queda reservado mientras completas el pago.
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="acciones">
          <button :disabled="!listo || enviando" @click="confirmarReserva">
            {{
              enviando ? 'Procesando…' : servicio.price > 0 ? `Reservar y pagar ${pesos(servicio.price)}` : 'Confirmar reserva'
            }}
          </button>
        </div>
      </section>
      <p v-else-if="error" class="error" role="alert">{{ error }}</p>
    </template>
  </main>
</template>

<style scoped>
.aviso {
  border-left: 4px solid var(--aviso);
  margin: 0;
}
.paso {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--acento-bg);
  color: var(--acento);
  font-size: 0.85rem;
}
select {
  width: 100%;
  max-width: 560px;
}
.detalle {
  margin: 6px 0;
  font-size: 0.9rem;
}
.grupo h3 {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-suave);
  margin: 12px 0 6px;
}
.opciones {
  display: grid;
  gap: 6px;
}
.opcion {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
.opcion.compacta {
  padding: 6px 12px;
}
.opcion.elegida {
  border-color: var(--acento);
  background: var(--acento-bg);
}
.opcion .texto {
  display: grid;
  flex: 1;
  min-width: 0;
}
.precio {
  font-weight: 600;
  white-space: nowrap;
}
.barra-horas {
  align-items: center;
  margin-bottom: 12px;
}
.dias {
  display: grid;
  gap: 12px;
}
.dia h3 {
  margin: 0 0 6px;
  font-size: 0.95rem;
  text-transform: capitalize;
}
.agenda {
  display: grid;
  gap: 4px;
  margin-bottom: 8px;
}
.turnos {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.resumen dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 16px;
  margin: 0 0 12px;
}
.resumen dt {
  color: var(--text-suave);
}
.resumen dd {
  margin: 0;
}
.total {
  font-weight: 700;
  color: var(--text-h);
}
.nota {
  font-size: 0.9rem;
}
</style>
