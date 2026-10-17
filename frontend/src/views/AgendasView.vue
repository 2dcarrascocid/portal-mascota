<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DisponibilidadAgenda from '../components/agenda/DisponibilidadAgenda.vue'
import ExcepcionesAgenda from '../components/agenda/ExcepcionesAgenda.vue'
import HorariosSemanales from '../components/agenda/HorariosSemanales.vue'
import { useBranches } from '../composables/useBranches'
import { useStaff } from '../composables/useStaff'
import { ROLES_PERSONAL } from '../lib/catalogos'

// Mantenedor de agendas: horarios semanales (5.1), excepciones y funciones
// especiales (5.2 y 5.3) y la disponibilidad resultante para las citas.
const { items: sucursales, cargar: cargarSucursales } = useBranches()
const { personal, cargar: cargarPersonal } = useStaff()

onMounted(() => Promise.all([cargarSucursales(), cargarPersonal()]))

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

const filtroSucursal = ref('')
const filtroProfesional = ref('')
const profesionales = computed(() => personal.value.filter((p) => p.activo && ROLES_PERSONAL.includes(p.role)))
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Programación de agenda</h1>
    </div>

    <div class="pestanas" role="tablist">
      <button
        v-for="p in PESTANAS"
        :key="p.clave"
        role="tab"
        :aria-selected="pestana.clave === p.clave"
        :class="{ secundario: pestana.clave !== p.clave }"
        class="pequeno"
        @click="elegir(p.clave)"
      >
        {{ p.texto }}
      </button>
    </div>

    <div class="filtros">
      <label>
        Sucursal
        <select v-model="filtroSucursal">
          <option value="">Todas</option>
          <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label>
        Profesional
        <select v-model="filtroProfesional">
          <option value="">Todos</option>
          <option v-for="p in profesionales" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
        </select>
      </label>
    </div>

    <component
      :is="pestana.componente"
      :key="pestana.clave"
      :sucursales="sucursales"
      :profesionales="profesionales"
      :filtro-sucursal="filtroSucursal"
      :filtro-profesional="filtroProfesional"
    />
  </main>
</template>

<style scoped>
.pestanas {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
