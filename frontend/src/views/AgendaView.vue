<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BuscarHora from '../components/citas/BuscarHora.vue'
import CitasAgendadas from '../components/citas/CitasAgendadas.vue'
import { useBranches } from '../composables/useBranches'
import { useServices } from '../composables/useServices'
import { useSpecialties } from '../composables/useSpecialties'
import { useStaff } from '../composables/useStaff'
import { ROLES_PERSONAL } from '../lib/catalogos'

// Módulo Agenda: buscar horas disponibles y reservar (con o sin ficha), y
// seguimiento de las citas agendadas. Los horarios se configuran en
// Configuración › Programación de agenda.
const { items: sucursales, cargar: cargarSucursales } = useBranches()
const { personal, cargar: cargarPersonal } = useStaff()
const { items: especialidades, cargar: cargarEspecialidades } = useSpecialties()
const { items: servicios, cargar: cargarServicios } = useServices()

onMounted(() => Promise.all([cargarSucursales(), cargarPersonal(), cargarEspecialidades(), cargarServicios()]))

const profesionales = computed(() => personal.value.filter((p) => p.activo && ROLES_PERSONAL.includes(p.role)))

const PESTANAS = [
  { clave: 'buscar', texto: 'Buscar hora' },
  { clave: 'citas', texto: 'Citas agendadas' },
]
const route = useRoute()
const router = useRouter()
const pestana = computed(() => (PESTANAS.some((p) => p.clave === route.query.tab) ? route.query.tab : 'buscar'))
const elegir = (clave) => router.replace({ query: { ...route.query, tab: clave } })

const nuevas = ref(0) // reservas hechas en esta visita
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Agenda</h1>
    </div>

    <div class="acciones" role="tablist">
      <button
        v-for="p in PESTANAS"
        :key="p.clave"
        role="tab"
        :aria-selected="pestana === p.clave"
        :class="{ secundario: pestana !== p.clave }"
        class="pequeno"
        @click="elegir(p.clave)"
      >
        {{ p.texto }}
        <span v-if="p.clave === 'citas' && nuevas" class="contador">+{{ nuevas }}</span>
      </button>
    </div>

    <BuscarHora
      v-if="pestana === 'buscar'"
      :sucursales="sucursales"
      :profesionales="profesionales"
      :especialidades="especialidades"
      :servicios="servicios"
      @reservada="nuevas++"
    />
    <CitasAgendadas v-else :sucursales="sucursales" :profesionales="profesionales" :servicios="servicios" />
  </main>
</template>

<style scoped>
.contador {
  margin-left: 4px;
  font-size: 0.75rem;
  font-weight: 700;
}
</style>
