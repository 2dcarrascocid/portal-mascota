<script setup>
import { computed } from 'vue'
import { useAuth } from '../composables/useAuth'
import { SECCIONES_CONFIGURACION, accesoSeccion } from '../lib/configuracion'

const auth = useAuth()
const secciones = computed(() => SECCIONES_CONFIGURACION.filter((s) => accesoSeccion(s, auth)))
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <div>
        <h1>Configuración</h1>
        <small class="suave">Mantenedores básicos para implementar el sistema. Se recomienda seguir este orden.</small>
      </div>
    </div>

    <p v-if="!secciones.length" class="panel vacio">Tu rol no tiene acceso a ninguna sección de configuración.</p>

    <ol class="tarjetas">
      <li v-for="s in secciones" :key="s.name">
        <RouterLink :to="{ name: s.name }" class="panel tarjeta">
          <strong>{{ s.texto }}</strong>
          <small class="suave">{{ s.descripcion }}</small>
        </RouterLink>
      </li>
    </ol>
  </main>
</template>

<style scoped>
.tarjetas {
  list-style: none;
  counter-reset: paso;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.tarjetas li {
  counter-increment: paso;
}
.tarjeta {
  display: grid;
  gap: 4px;
  height: 100%;
  color: var(--text);
  text-decoration: none;
  transition: border-color 0.15s;
}
.tarjeta:hover {
  border-color: var(--acento);
}
.tarjeta strong {
  color: var(--text-h);
}
.tarjeta strong::before {
  content: counter(paso) '. ';
  color: var(--acento);
}
</style>
