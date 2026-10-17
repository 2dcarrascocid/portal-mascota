<script setup>
import { computed } from 'vue'
import { useAuth } from '../composables/useAuth'
import { SECCIONES_CONFIGURACION, accesoSeccion } from '../lib/configuracion'

const auth = useAuth()
const secciones = computed(() => SECCIONES_CONFIGURACION.filter((s) => accesoSeccion(s, auth)))
</script>

<template>
  <div>
    <nav class="submenu" aria-label="Configuración">
      <div class="submenu-interior">
        <RouterLink :to="{ name: 'configuracion' }" class="titulo" exact-active-class="activo">Configuración</RouterLink>
        <span class="separador-v" aria-hidden="true"></span>
        <RouterLink v-for="s in secciones" :key="s.name" :to="{ name: s.name }" active-class="activo">
          {{ s.texto }}
        </RouterLink>
      </div>
    </nav>
    <RouterView />
  </div>
</template>

<style scoped>
.submenu {
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.submenu-interior {
  display: flex;
  align-items: center;
  gap: 2px;
  width: min(100%, 960px);
  margin: 0 auto;
  padding: 6px 16px;
  overflow-x: auto;
}
.submenu a {
  padding: 5px 10px;
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
  white-space: nowrap;
  font-size: 0.88rem;
}
.submenu a:hover {
  background: var(--acento-bg);
}
.submenu a.activo {
  color: var(--acento);
  font-weight: 600;
  box-shadow: inset 0 -2px 0 var(--acento);
  border-radius: 6px 6px 0 0;
}
.submenu .titulo {
  font-weight: 600;
  color: var(--text-h);
}
.separador-v {
  width: 1px;
  height: 18px;
  margin: 0 6px;
  background: var(--border);
  flex: none;
}
</style>
