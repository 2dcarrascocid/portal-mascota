<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const textos = {
  aprobado: { icono: '✅', titulo: 'Pago aprobado', clase: 'ok' },
  rechazado: { icono: '❌', titulo: 'Pago rechazado', clase: 'mal' },
  anulado: { icono: '↩️', titulo: 'Pago anulado', clase: 'aviso' },
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
      <p v-if="route.query.orden" class="suave">Orden {{ route.query.orden }}</p>
      <RouterLink to="/">Volver al inicio</RouterLink>
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
</style>
