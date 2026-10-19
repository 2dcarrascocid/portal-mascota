<script setup>
import { computed, ref, watch } from 'vue'
import { disponibilidad } from '../../composables/useSchedules'
import { conEspecialidad } from '../../composables/useStaff'
import { fechaCorta, hhmm, hoy, lunesDe, sumarDias } from '../../lib/fechas'
import { mensajeError } from '../../services/api'

// Resultado de horarios semanales + excepciones: los turnos que quedarán
// disponibles para agendar citas, semana a semana.
const props = defineProps({
  sucursales: { type: Array, required: true },
  profesionales: { type: Array, required: true },
  filtroSucursal: { type: String, default: '' },
  filtroEspecialidad: { type: String, default: '' },
  filtroProfesional: { type: String, default: '' },
})

const lunes = ref(lunesDe(hoy()))
const todos = ref([])
// Con especialidad: solo las agendas de profesionales que la tienen.
const dias = computed(() =>
  todos.value.map((d) => ({
    ...d,
    agendas: d.agendas.filter((a) => conEspecialidad(props.profesionales, a.staff_id, props.filtroEspecialidad)),
  }))
)
const cargando = ref(false)
const error = ref('')

async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    todos.value = await disponibilidad({
      desde: lunes.value,
      hasta: sumarDias(lunes.value, 6),
      ...(props.filtroSucursal && { branchId: props.filtroSucursal }),
      ...(props.filtroProfesional && { staffId: props.filtroProfesional }),
    })
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
}
watch(() => [lunes.value, props.filtroSucursal, props.filtroProfesional], cargar, { immediate: true })

const nombre = (id) => {
  const p = props.profesionales.find((x) => x.id === id)
  return p?.full_name || p?.email || 'Profesional'
}
const sucursal = (id) => props.sucursales.find((s) => s.id === id)?.name ?? 'Sucursal'
const totalTurnos = computed(() => dias.value.reduce((n, d) => n + d.agendas.reduce((m, a) => m + a.turnos.length, 0), 0))

const bloqueo = (b) => `${b.start_time ? `${hhmm(b.start_time)}–${hhmm(b.end_time)}` : 'Día completo'}${b.reason ? ` · ${b.reason}` : ''}`
</script>

<template>
  <div class="pagina">
    <div class="pagina-cabecera">
      <div class="acciones">
        <button class="secundario pequeno" aria-label="Semana anterior" @click="lunes = sumarDias(lunes, -7)">‹</button>
        <strong>{{ fechaCorta(lunes, { dia: false }) }} – {{ fechaCorta(sumarDias(lunes, 6), { anio: true, dia: false }) }}</strong>
        <button class="secundario pequeno" aria-label="Semana siguiente" @click="lunes = sumarDias(lunes, 7)">›</button>
        <button class="secundario pequeno" @click="lunes = lunesDe(hoy())">Hoy</button>
      </div>
      <small class="suave">{{ totalTurnos }} turnos disponibles en la semana</small>
    </div>

    <div class="leyenda">
      <span class="turno">Semanal</span>
      <span class="turno extra">Horario extra</span>
      <span class="turno cambio">Cambio de horario</span>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="cargando" class="vacio">Cargando…</p>

    <template v-else>
      <section v-for="d in dias" :key="d.fecha" class="panel" :class="{ hoy: d.fecha === hoy() }">
        <h3>{{ fechaCorta(d.fecha) }}</h3>
        <p v-if="!d.agendas.length" class="suave" style="margin: 0">Sin atención.</p>
        <div v-for="a in d.agendas" :key="a.staff_id + a.branch_id" class="agenda">
          <div>
            <strong>{{ nombre(a.staff_id) }}</strong>
            <small class="suave"> · {{ sucursal(a.branch_id) }}</small>
          </div>
          <div v-if="a.turnos.length" class="chips">
            <span
              v-for="t in a.turnos"
              :key="t.inicio"
              class="turno"
              :class="{ extra: t.origen === 'EXTRA', cambio: t.origen === 'CAMBIO' }"
              :title="`${t.inicio} – ${t.fin}`"
            >
              {{ t.inicio }}
            </span>
          </div>
          <small v-else class="suave">Sin turnos disponibles.</small>
          <div v-if="a.bloqueos.length" class="chips">
            <span v-for="b in a.bloqueos" :key="b.id" class="chip bloqueado">Bloqueo: {{ bloqueo(b) }}</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.panel.hoy {
  border-color: var(--acento);
}
.agenda {
  display: grid;
  gap: 6px;
  padding: 8px 0;
  border-top: 1px solid var(--border);
}
.agenda:first-of-type {
  border-top: 0;
}
.leyenda {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 0.85rem;
}
.turno {
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--superficie);
  color: var(--text-h);
}
.turno.extra {
  border-color: var(--ok);
  color: var(--ok);
}
.turno.cambio {
  border-color: var(--aviso);
  color: var(--aviso);
}
.chip.bloqueado {
  background: color-mix(in srgb, var(--peligro) 14%, transparent);
  color: var(--peligro);
  white-space: normal;
}
</style>
