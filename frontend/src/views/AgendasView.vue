<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DisponibilidadAgenda from '../components/agenda/DisponibilidadAgenda.vue'
import ExcepcionesAgenda from '../components/agenda/ExcepcionesAgenda.vue'
import HorariosSemanales from '../components/agenda/HorariosSemanales.vue'
import { useAuth } from '../composables/useAuth'
import { useBranches } from '../composables/useBranches'
import { especialidadesDe } from '../composables/useReception'
import { useSpecialties } from '../composables/useSpecialties'
import { useStaff } from '../composables/useStaff'
import { ROLES_PERSONAL } from '../lib/catalogos'

// Mantenedor de agendas: horarios semanales (5.1), excepciones y funciones
// especiales (5.2 y 5.3) y la disponibilidad resultante para las citas.
// Dos columnas, como Recepción y Caja: a la izquierda sucursal, especialidad
// y profesional (filtran las pestañas y dicen para quién es un horario
// nuevo); a la derecha, la pestaña elegida.
const { esAdminOrg } = useAuth()
const { items: sucursales, cargar: cargarSucursales } = useBranches()
const { items: especialidades, cargar: cargarEspecialidades } = useSpecialties()
const { personal, cargar: cargarPersonal } = useStaff()

const filtroSucursal = ref('')
const filtroEspecialidad = ref('')
const filtroProfesional = ref('')

onMounted(async () => {
  await Promise.all([cargarSucursales(), cargarPersonal(), cargarEspecialidades()])
  // Por defecto, la sucursal asignada (si es una sola).
  if (sucursales.value.length === 1) filtroSucursal.value = sucursales.value[0].id
})

const PESTANAS = [
  { clave: 'horarios', texto: 'Horarios semanales', componente: HorariosSemanales },
  { clave: 'excepciones', texto: 'Excepciones y ajustes', componente: ExcepcionesAgenda },
  { clave: 'disponibilidad', texto: 'Disponibilidad', componente: DisponibilidadAgenda },
]

// La pestaña queda en la URL (?tab=) para volver a ella.
const route = useRoute()
const router = useRouter()
const pestana = computed(() => PESTANAS.find((p) => p.clave === route.query.tab) ?? PESTANAS[0])
const elegir = (clave) => router.replace({ query: { ...route.query, tab: clave } })

// Las pestañas reciben a todo el personal (para mostrar nombres); los
// filtros se encadenan: sucursal -> especialidades de su personal ->
// profesionales con esa especialidad.
const profesionales = computed(() => personal.value.filter((p) => p.activo && ROLES_PERSONAL.includes(p.role)))
const deLaSucursal = computed(() =>
  filtroSucursal.value
    ? profesionales.value.filter((p) => p.branch_ids?.includes(filtroSucursal.value))
    : profesionales.value
)
const opcionesEspecialidad = computed(() =>
  especialidadesDe(
    deLaSucursal.value.filter((p) => p.specialty_ids?.length),
    especialidades.value
  )
)
const opcionesProfesional = computed(() =>
  deLaSucursal.value.filter((p) => !filtroEspecialidad.value || p.specialty_ids?.includes(filtroEspecialidad.value))
)
watch(opcionesEspecialidad, (lista) => {
  if (filtroEspecialidad.value && !lista.some((e) => e.id === filtroEspecialidad.value)) filtroEspecialidad.value = ''
})
watch(opcionesProfesional, (lista) => {
  if (filtroProfesional.value && !lista.some((p) => p.id === filtroProfesional.value)) filtroProfesional.value = ''
})

const sucursal = computed(() => sucursales.value.find((s) => s.id === filtroSucursal.value)?.name)
const especialidad = computed(() => especialidades.value.find((e) => e.id === filtroEspecialidad.value)?.name)
const profesional = computed(() => {
  const p = profesionales.value.find((x) => x.id === filtroProfesional.value)
  return p && (p.full_name || p.email)
})
const hayFiltros = computed(
  () => filtroProfesional.value || filtroEspecialidad.value || (filtroSucursal.value && sucursales.value.length > 1)
)
const limpiar = () => {
  filtroProfesional.value = ''
  filtroEspecialidad.value = ''
  if (sucursales.value.length > 1) filtroSucursal.value = ''
}
</script>

<template>
  <main class="contenedor pagina ancha">
    <div class="pagina-cabecera">
      <h1>Programación de agenda</h1>
    </div>

    <div class="dividida">
      <!-- Izquierda: filtros -->
      <aside class="panel filtros-lateral" aria-label="Filtros">
        <label>
          Sucursal
          <select v-model="filtroSucursal">
            <option v-if="esAdminOrg || sucursales.length > 1" value="">Todas</option>
            <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label>
          Especialidad
          <select v-model="filtroEspecialidad">
            <option value="">Todas</option>
            <option v-for="e in opcionesEspecialidad" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
        </label>
        <label>
          Profesional
          <select v-model="filtroProfesional">
            <option value="">Todos</option>
            <option v-for="p in opcionesProfesional" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
          </select>
          <small v-if="filtroSucursal && !opcionesProfesional.length" class="suave">
            Nadie {{ filtroEspecialidad ? 'con esa especialidad ' : '' }}está asignado a esta sucursal (ver Personal).
          </small>
        </label>
        <button v-if="hayFiltros" type="button" class="secundario pequeno" @click="limpiar">Limpiar filtros</button>
      </aside>

      <!-- Derecha: la pestaña elegida (un solo panel, a la misma altura que los filtros) -->
      <section class="panel resultados">
        <header class="cabecera">
          <h2>
            {{ pestana.texto }}
            <small class="suave">
              · {{ [sucursal || 'Todas las sucursales', especialidad, profesional].filter(Boolean).join(' · ') }}
            </small>
          </h2>
          <div class="acciones" role="tablist" aria-label="Sección">
            <button
              v-for="p in PESTANAS"
              :key="p.clave"
              role="tab"
              :aria-selected="pestana.clave === p.clave"
              class="pequeno"
              :class="{ secundario: pestana.clave !== p.clave }"
              @click="elegir(p.clave)"
            >
              {{ p.texto }}
            </button>
          </div>
        </header>

        <component
          :is="pestana.componente"
          :key="pestana.clave"
          :sucursales="sucursales"
          :profesionales="profesionales"
          :filtro-sucursal="filtroSucursal"
          :filtro-especialidad="filtroEspecialidad"
          :filtro-profesional="filtroProfesional"
        />
      </section>
    </div>
  </main>
</template>

<style scoped>
/* Dos columnas, como Recepción y Caja: filtros | contenido. */
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
.filtros-lateral select {
  width: 100%;
  min-width: 0;
}
.resultados {
  display: grid;
  gap: 12px;
  align-content: start;
  min-width: 0;
}
.cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.cabecera h2 {
  margin: 0;
  font-size: 1.05rem;
}
.cabecera h2 small {
  font-weight: 400;
  font-size: 0.85rem;
}
/* Los paneles internos de las pestañas (formularios, días) quedan sobre el fondo. */
.resultados :deep(.panel) {
  background: var(--bg);
}
@media (max-width: 760px) {
  .dividida {
    grid-template-columns: 1fr;
  }
}
</style>
