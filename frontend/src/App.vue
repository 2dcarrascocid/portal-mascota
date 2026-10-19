<script setup>
import { computed } from 'vue'
import DialogoGlobal from './components/DialogoGlobal.vue'
import { useAuth } from './composables/useAuth'
import { ROLES } from './lib/catalogos'
import { SECCIONES_CONFIGURACION, accesoSeccion } from './lib/configuracion'

const auth = useAuth()
const { usuario, perfil, organizacion, autenticado, esPersonal, esTutor, puede, logout } = auth

const nombre = computed(() => perfil.value?.full_name || usuario.value?.email)

// Portal del tutor (rol CLIENT).
const MENU_TUTOR = [
  { to: '/mi', texto: 'Inicio', exacto: true },
  { to: '/mi/reservar', texto: 'Reservar hora' },
  { to: '/mi/citas', texto: 'Mis citas' },
  { to: '/mi/mascotas', texto: 'Mis mascotas' },
  { to: '/mi/sucursales', texto: 'Sucursales cercanas' },
  { to: '/mi/historial', texto: 'Historial' },
  { to: '/mi/perfil', texto: 'Mi perfil' },
]

// Menú según los permisos del rol. Los mantenedores básicos van agrupados
// en Configuración (con su propio submenú).
const menu = computed(() => {
  if (esTutor.value) return MENU_TUTOR
  if (!esPersonal.value || !organizacion.value) return []
  return [
    { to: '/recepcion', texto: 'Recepción', permiso: 'recepcion.ver' },
    { to: '/caja', texto: 'Pagos y caja', permiso: 'caja.ver' },
    { to: '/agenda', texto: 'Agenda', permiso: 'citas.ver' },
    { to: '/tutores', texto: 'Tutores y mascotas', permiso: 'tutores.ver' },
    {
      to: '/configuracion',
      texto: '⚙ Configuración',
      visible: SECCIONES_CONFIGURACION.some((s) => accesoSeccion(s, auth)),
    },
  ].filter((m) => (m.permiso ? puede(m.permiso) : m.visible))
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
      <span v-if="perfil" class="etiqueta">{{ esTutor ? 'Tutor/a' : perfil.rol_nombre || ROLES[perfil.role] }}</span>
      <button class="secundario" @click="logout">Salir</button>
    </div>
  </header>

  <nav v-if="autenticado && menu.length" class="menu" aria-label="Secciones">
    <RouterLink
      v-for="m in menu"
      :key="m.to"
      :to="m.to"
      :active-class="m.exacto ? '' : 'router-link-active'"
      :exact-active-class="'router-link-active'"
    >
      {{ m.texto }}
    </RouterLink>
  </nav>

  <RouterView />

  <!-- Confirmaciones, avisos y pedidos de texto de toda la app (useDialogo) -->
  <DialogoGlobal />
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
