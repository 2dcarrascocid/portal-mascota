import { watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../composables/useAuth'

// meta:
//   publica         -> accesible sin sesión
//   soloInvitado    -> si hay sesión, se redirige al inicio (login/registro)
//   sinOrganizacion -> privada, pero no exige tener organización asignada
//   roles           -> lista de roles permitidos (opcional)
const PERSONAL = ['ORG_ADMIN', 'VET', 'GROOMER', 'TRAINER']
const ADMIN_ORG = ['ORG_ADMIN']

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { publica: true, soloInvitado: true },
    },
    {
      path: '/registro',
      name: 'registro',
      component: () => import('../views/RegistroView.vue'),
      meta: { publica: true, soloInvitado: true },
    },
    {
      // Link del correo de confirmación
      path: '/auth/verificar',
      name: 'verificar-email',
      component: () => import('../views/VerificarEmailView.vue'),
      meta: { publica: true },
    },
    {
      path: '/recuperar',
      name: 'recuperar',
      component: () => import('../views/RecuperarView.vue'),
      meta: { publica: true, soloInvitado: true },
    },
    {
      // Link del correo de recuperación de contraseña
      path: '/restablecer',
      name: 'restablecer',
      component: () => import('../views/RestablecerView.vue'),
      meta: { publica: true },
    },
    {
      // Vuelta desde Google/Facebook
      path: '/auth/callback',
      name: 'auth-callback',
      component: () => import('../views/AuthCallbackView.vue'),
      meta: { publica: true },
    },
    {
      path: '/entidad',
      name: 'entidad',
      component: () => import('../views/EntidadView.vue'),
      meta: { sinOrganizacion: true },
    },
    {
      path: '/',
      name: 'inicio',
      component: () => import('../views/InicioView.vue'),
    },
    {
      path: '/sucursales',
      name: 'sucursales',
      component: () => import('../views/SucursalesView.vue'),
      meta: { roles: PERSONAL },
    },
    {
      path: '/personal',
      name: 'personal',
      component: () => import('../views/PersonalView.vue'),
      meta: { roles: ADMIN_ORG },
    },
    {
      path: '/especialidades',
      name: 'especialidades',
      component: () => import('../views/EspecialidadesView.vue'),
      meta: { roles: PERSONAL },
    },
    {
      path: '/agendas',
      name: 'agendas',
      component: () => import('../views/AgendasView.vue'),
      meta: { roles: PERSONAL },
    },
    {
      path: '/catalogos/especies',
      name: 'especies',
      component: () => import('../views/EspeciesView.vue'),
      meta: { roles: PERSONAL },
    },
    {
      path: '/catalogos/servicios',
      name: 'servicios',
      component: () => import('../views/ServiciosView.vue'),
      meta: { roles: PERSONAL },
    },
    {
      path: '/tutores',
      name: 'tutores',
      component: () => import('../views/TutoresView.vue'),
      meta: { roles: PERSONAL },
    },
    {
      // Destino al que redirige el backend después de Webpay
      path: '/pago/resultado',
      name: 'pago-resultado',
      component: () => import('../views/PagoResultadoView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'no-encontrado',
      component: () => import('../views/NoEncontradoView.vue'),
      meta: { publica: true },
    },
  ],
})

const { autenticado, necesitaEntidad, rol, iniciar } = useAuth()

const conRedirect = (name, to) => ({
  name,
  query: to.fullPath !== '/' ? { redirect: to.fullPath } : {},
})

router.beforeEach(async (to) => {
  await iniciar()

  if (to.meta.publica) {
    if (to.meta.soloInvitado && autenticado.value) return { name: 'inicio' }
    return
  }
  if (!autenticado.value) return conRedirect('login', to)

  if (to.meta.sinOrganizacion) {
    if (to.name === 'entidad' && !necesitaEntidad.value) return { name: 'inicio' }
    return
  }
  if (necesitaEntidad.value) return conRedirect('entidad', to)

  if (to.meta.roles && !to.meta.roles.includes(rol.value)) return { name: 'inicio' }
})

// Al cerrar sesión (botón, otra pestaña o refresh fallido) sale de las páginas protegidas.
watch(autenticado, (activo) => {
  if (!activo && !router.currentRoute.value.meta.publica) router.push({ name: 'login' })
})

export default router
