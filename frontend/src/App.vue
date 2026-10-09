<script setup>
import { computed } from 'vue'
import { useAuth } from './composables/useAuth'
import { ROLES } from './lib/catalogos'

const { usuario, perfil, organizacion, autenticado, esAdminOrg, esPersonal, logout } = useAuth()

const nombre = computed(() => perfil.value?.full_name || usuario.value?.email)

// Menú según el rol: el personal opera; solo el ORG_ADMIN administra el personal.
const menu = computed(() => {
  if (!esPersonal.value || !organizacion.value) return []
  return [
    { to: '/tutores', texto: 'Tutores y mascotas' },
    { to: '/agendas', texto: 'Agendas' },
    { to: '/sucursales', texto: 'Sucursales' },
    ...(esAdminOrg.value
      ? [
          { to: '/personal', texto: 'Personal' },
          { to: '/especialidades', texto: 'Especialidades' },
        ]
      : []),
    { to: '/catalogos/servicios', texto: 'Servicios' },
    { to: '/catalogos/especies', texto: 'Especies' },
  ]
})
</script>

<template>
  <header v-if="autenticado" class="barra">
    <RouterLink to="/" class="logo">🐾 Portal Animal</RouterLink>
    <div class="usuario">
      <img v-if="perfil?.avatar_url" :src="perfil.avatar_url" alt="" referrerpolicy="no-referrer" />
      <span class="nombre">
        {{ nombre }}
        <small v-if="organizacion">{{ organizacion.name }}</small>
      </span>
      <span v-if="perfil" class="etiqueta">{{ ROLES[perfil.role] }}</span>
      <button class="secundario" @click="logout">Salir</button>
    </div>
  </header>

  <nav v-if="autenticado && menu.length" class="menu" aria-label="Secciones">
    <RouterLink v-for="m in menu" :key="m.to" :to="m.to">{{ m.texto }}</RouterLink>
  </nav>

  <RouterView />
</template>

<style scoped>
.barra {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--superficie);
}
.logo {
  font-weight: 700;
  color: var(--text-h);
  text-decoration: none;
  white-space: nowrap;
}
.usuario {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.usuario img {
  width: 32px;
  height: 32px;
  border-radius: 50%;
}
.nombre {
  display: grid;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}
.nombre small {
  color: var(--text-suave);
  overflow: hidden;
  text-overflow: ellipsis;
}
.etiqueta {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--acento-bg);
  color: var(--acento);
  white-space: nowrap;
}
.menu {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
  background: var(--superficie);
}
.menu a {
  padding: 6px 12px;
  border-radius: 8px;
  color: var(--text);
  text-decoration: none;
  white-space: nowrap;
  font-size: 0.92rem;
}
.menu a:hover {
  background: var(--acento-bg);
}
.menu a.router-link-active {
  background: var(--acento-bg);
  color: var(--acento);
  font-weight: 600;
}
@media (max-width: 480px) {
  .nombre {
    display: none;
  }
}
</style>
