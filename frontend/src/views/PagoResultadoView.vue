<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const route = useRoute()
const { esTutor } = useAuth()

const textos = {
  aprobado: { icono: '✅', titulo: 'Pago aprobado', clase: 'ok', cita: 'Tu hora quedó reservada y pagada.' },
  rechazado: {
    icono: '❌',
    titulo: 'Pago rechazado',
    clase: 'mal',
    cita: 'La hora sigue reservada por unos minutos: puedes reintentar el pago desde "Mis citas".',
  },
  anulado: {
    icono: '↩️',
    titulo: 'Pago anulado',
    clase: 'aviso',
    cita: 'La hora sigue reservada por unos minutos: puedes reintentar el pago desde "Mis citas".',
  },
  sin_cita: {
    icono: '⚠️',
    titulo: 'Pago aprobado, pero la reserva venció',
    clase: 'aviso',
    cita: 'El horario se liberó antes de confirmar el pago y ya lo tomó otra persona. Contacta a la sucursal para reagendar o pedir la devolución.',
  },
  error: {
    icono: '❔',
    titulo: 'No pudimos confirmar el pago',
    clase: 'aviso',
    cita: 'Revisa el estado de tu reserva en "Mis citas" antes de volver a pagar.',
  },
}
const resultado = computed(
  () => textos[route.query.estado] || { icono: '❔', titulo: 'Estado desconocido', clase: 'aviso' }
)
</script>

<template>
  <main class="contenedor resultado">
    <div class="tarjeta" :class="resultado.clase">
      <div class="icono">{{ resultado.icono }}</div>
      <h1>{{ resultado.titulo }}</h1>
      <p v-if="route.query.cita && resultado.cita">{{ resultado.cita }}</p>
      <p v-if="route.query.orden" class="suave">Orden {{ route.query.orden }}</p>
      <RouterLink v-if="esTutor" :to="{ name: 'mi-citas' }">Ir a mis citas</RouterLink>
      <RouterLink v-else to="/">Volver al inicio</RouterLink>
    </div>
  </main>
</template>

<style scoped>
.tarjeta {
  max-width: 420px;
  margin: 48px auto;
  padding: 32px 24px;
  text-align: center;
  border: 1px solid var(--border);
  border-top: 4px solid var(--border);
  border-radius: var(--radio);
  background: var(--superficie);
  display: grid;
  gap: 8px;
}
.ok {
  border-top-color: var(--ok);
}
.mal {
  border-top-color: var(--peligro);
}
.aviso {
  border-top-color: var(--aviso);
}
.icono {
  font-size: 2.5rem;
}
h1 {
  margin: 0;
}
p {
  margin: 0;
}
</style>
