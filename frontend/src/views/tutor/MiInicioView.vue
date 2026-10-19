<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { usePortal } from '../../composables/usePortal'
import { ESTADOS_CITA } from '../../lib/catalogos'
import { fechaCorta, hhmm, hoy } from '../../lib/fechas'
import { mensajeError } from '../../services/api'

const { perfil: cuenta } = useAuth()
const { perfilCompleto, mascotas, cargarPerfil, cargarMascotas, listarCitas } = usePortal()

const citas = ref([])
const cargando = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    const [, , lista] = await Promise.all([cargarPerfil(), cargarMascotas(), listarCitas()])
    citas.value = lista
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
})

const proximas = computed(() =>
  citas.value
    .filter((c) => c.date >= hoy() && ['RESERVADA', 'CONFIRMADA', 'LLEGO'].includes(c.status))
    .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))
    .slice(0, 3)
)
const pendientesDePago = computed(() => citas.value.filter((c) => c.payment_status === 'PENDIENTE' && c.status !== 'CANCELADA'))

const accesos = [
  { to: { name: 'mi-reservar' }, icono: '📅', titulo: 'Reservar hora', texto: 'Elige sucursal, servicio y horario, y paga en línea.' },
  { to: { name: 'mi-sucursales' }, icono: '📍', titulo: 'Sucursales cercanas', texto: 'Encuentra la atención más próxima a tu dirección.' },
  { to: { name: 'mi-mascotas' }, icono: '🐶', titulo: 'Mis mascotas', texto: 'Registra y actualiza los datos de tus mascotas.' },
  { to: { name: 'mi-historial' }, icono: '📋', titulo: 'Historial', texto: 'Las atenciones de tus mascotas en todas las sucursales.' },
]
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Hola, {{ cuenta?.full_name?.split(' ')[0] || 'tutor/a' }} 👋</h1>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section v-if="!cargando && !perfilCompleto" class="panel aviso">
      <strong>Completa tu perfil</strong>
      <p>Necesitamos tus nombres, apellidos y dirección para reservar y mostrarte las sucursales más cercanas.</p>
      <RouterLink :to="{ name: 'mi-perfil' }">Completar mi perfil →</RouterLink>
    </section>

    <section v-if="!cargando && perfilCompleto && !mascotas.length" class="panel aviso">
      <strong>Registra a tu primera mascota</strong>
      <p>Para reservar una hora necesitas al menos una mascota registrada.</p>
      <RouterLink :to="{ name: 'mi-mascotas' }">Agregar mascota →</RouterLink>
    </section>

    <section v-if="pendientesDePago.length" class="panel aviso">
      <strong>Tienes {{ pendientesDePago.length }} reserva(s) con el pago pendiente</strong>
      <p>El horario se libera si no completas el pago a tiempo.</p>
      <RouterLink :to="{ name: 'mi-citas' }">Ir a mis citas →</RouterLink>
    </section>

    <section class="panel">
      <h2>Próximas citas</h2>
      <p v-if="cargando" class="suave">Cargando…</p>
      <p v-else-if="!proximas.length" class="vacio">
        No tienes citas próximas. <RouterLink :to="{ name: 'mi-reservar' }">Reservar una hora</RouterLink>
      </p>
      <ul v-else class="citas">
        <li v-for="c in proximas" :key="c.id">
          <div>
            <strong>{{ fechaCorta(c.date) }} · {{ hhmm(c.start_time) }}</strong>
            <span class="suave">{{ c.service?.name || 'Atención' }} para {{ c.pet?.name || 'tu mascota' }}</span>
            <small class="suave">{{ c.organization?.name }} — {{ c.branch?.name }}</small>
          </div>
          <span class="chip" :class="{ gris: c.status !== 'CONFIRMADA' }">{{ ESTADOS_CITA[c.status] }}</span>
        </li>
      </ul>
      <RouterLink v-if="proximas.length" :to="{ name: 'mi-citas' }">Ver todas mis citas</RouterLink>
    </section>

    <div class="accesos">
      <RouterLink v-for="a in accesos" :key="a.titulo" :to="a.to" class="panel acceso">
        <span class="icono" aria-hidden="true">{{ a.icono }}</span>
        <strong>{{ a.titulo }}</strong>
        <small class="suave">{{ a.texto }}</small>
      </RouterLink>
    </div>

    <p class="suave entidad">
      ¿Administras una veterinaria, peluquería o centro? <RouterLink :to="{ name: 'entidad' }">Registra tu entidad</RouterLink>
    </p>
  </main>
</template>

<style scoped>
.aviso {
  border-left: 4px solid var(--aviso);
  display: grid;
  gap: 4px;
}
.aviso p {
  margin: 0;
}
.citas {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: grid;
  gap: 8px;
}
.citas li {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.citas li div {
  display: grid;
  gap: 2px;
}
.accesos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
.acceso {
  display: grid;
  gap: 4px;
  text-decoration: none;
  color: var(--text);
  transition: border-color 0.15s;
}
.acceso:hover {
  border-color: var(--acento);
}
.acceso strong {
  color: var(--text-h);
}
.icono {
  font-size: 1.6rem;
}
.entidad {
  font-size: 0.9rem;
  text-align: center;
}
</style>
