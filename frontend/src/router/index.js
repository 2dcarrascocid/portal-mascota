import { watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { ROLES_PERSONAL } from '../lib/catalogos'
import { SECCIONES_CONFIGURACION } from '../lib/configuracion'

// meta:
//   publica         -> accesible sin sesión
//   soloInvitado    -> si hay sesión, se redirige al inicio (login/registro)
//   sinOrganizacion -> privada, pero no exige tener organización asignada
//   tutor           -> portal del tutor: solo rol CLIENT (sin organización)
//   roles          -> lista de cargos permitidos (opcional)
//   permiso         -> permiso 'modulo.ver' necesario (opcional)
const PERSONAL = ROLES_PERSONAL
const ADMIN_ORG = ['ORG_ADMIN']

const COMPONENTES_CONFIGURACION = {
  'config-roles': () => import('../views/RolesView.vue'),
  'config-sucursales': () => import('../views/SucursalesView.vue'),
  'config-especies': () => import('../views/EspeciesView.vue'),
  'config-personal': () => import('../views/PersonalView.vue'),
  'config-especialidades': () => import('../views/EspecialidadesView.vue'),
  'config-servicios': () => import('../views/ServiciosView.vue'),
  'config-agendas': () => import('../views/AgendasView.vue'),
}

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
      // Ingreso del tutor de mascotas (botón de Google Identity Services)
      path: '/tutor/ingresar',
      name: 'tutor-login',
      component: () => import('../views/TutorLoginView.vue'),
      meta: { publica: true, soloInvitado: true },
    },
    // Portal del tutor (rol CLIENT): no depende de pertenecer a una organización.
    ...[
      { path: '', name: 'mi-inicio', vista: () => import('../views/tutor/MiInicioView.vue') },
      { path: 'perfil', name: 'mi-perfil', vista: () => import('../views/tutor/MiPerfilView.vue') },
      { path: 'mascotas', name: 'mi-mascotas', vista: () => import('../views/tutor/MisMascotasView.vue') },
      { path: 'sucursales', name: 'mi-sucursales', vista: () => import('../views/tutor/SucursalesCercanasView.vue') },
      { path: 'reservar', name: 'mi-reservar', vista: () => import('../views/tutor/ReservarView.vue') },
      { path: 'citas', name: 'mi-citas', vista: () => import('../views/tutor/MisCitasView.vue') },
      { path: 'historial', name: 'mi-historial', vista: () => import('../views/tutor/HistorialView.vue') },
    ].map(({ path, name, vista }) => ({
      path: path ? `/mi/${path}` : '/mi',
      name,
      component: vista,
      meta: { tutor: true },
    })),
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
      // Mantenedores básicos: submenú + una ruta hija por sección.
      path: '/configuracion',
      component: () => import('../views/ConfiguracionView.vue'),
      meta: { roles: PERSONAL },
      children: [
        { path: '', name: 'configuracion', component: () => import('../views/ConfiguracionInicioView.vue') },
        ...SECCIONES_CONFIGURACION.map((s) => ({
          path: s.path,
          name: s.name,
          component: COMPONENTES_CONFIGURACION[s.name],
          meta: s.soloAdmin ? { roles: ADMIN_ORG } : { permiso: s.permiso },
        })),
      ],
    },
    // Direcciones anteriores al menú Configuración.
    { path: '/personal', redirect: { name: 'config-personal' } },
    { path: '/especialidades', redirect: { name: 'config-especialidades' } },
    { path: '/agendas', redirect: { name: 'config-agendas' } },
    { path: '/configuracion/agendas', redirect: { name: 'config-agendas' } },
    { path: '/catalogos/servicios', redirect: { name: 'config-servicios' } },
    { path: '/sucursales', redirect: { name: 'config-sucursales' } },
    { path: '/catalogos/especies', redirect: { name: 'config-especies' } },
    {
      // Módulo Agenda: búsqueda de horas y reserva de citas.
      path: '/agenda',
      name: 'agenda',
      component: () => import('../views/AgendaView.vue'),
      meta: { roles: PERSONAL, permiso: 'citas.ver' },
    },
    {
      // Módulo Recepción: llegada de mascotas y atención hasta el cierre.
      path: '/recepcion',
      name: 'recepcion',
      component: () => import('../views/RecepcionView.vue'),
      meta: { roles: PERSONAL, permiso: 'recepcion.ver' },
    },
    {
      // Módulo Pagos y caja: resumen de pagos del día, cuadratura y cierre diario.
      path: '/caja',
      name: 'caja',
      component: () => import('../views/CajaView.vue'),
      meta: { roles: PERSONAL, permiso: 'caja.ver' },
    },
    {
      path: '/tutores',
      name: 'tutores',
      component: () => import('../views/TutoresView.vue'),
      meta: { roles: PERSONAL, permiso: 'tutores.ver' },
    },
    {
      // Destino al que redirige el backend después de Webpay
      path: '/pago/resultado',
      name: 'pago-resultado',
      component: () => import('../views/PagoResultadoView.vue'),
      meta: { sinOrganizacion: true },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'no-encontrado',
      component: () => import('../views/NoEncontradoView.vue'),
      meta: { publica: true },
    },
  ],
})

const { autenticado, necesitaEntidad, esTutor, rol, puede, iniciar } = useAuth()

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
  if (!autenticado.value) return conRedirect(to.meta.tutor ? 'tutor-login' : 'login', to)

  if (to.meta.tutor) return esTutor.value ? undefined : { name: 'inicio' }
  if (to.meta.sinOrganizacion) {
    if (to.name === 'entidad' && !necesitaEntidad.value) return { name: 'inicio' }
    return
  }
  // El tutor usa su portal; /entidad le queda disponible para registrar una.
  if (esTutor.value) return { name: 'mi-inicio' }
  if (necesitaEntidad.value) return conRedirect('entidad', to)

  if (to.meta.roles && !to.meta.roles.includes(rol.value)) return { name: 'inicio' }
  if (to.meta.permiso && !puede(to.meta.permiso)) return { name: 'inicio' }
})

// Al cerrar sesión (botón, otra pestaña o refresh fallido) sale de las páginas protegidas.
watch(autenticado, (activo) => {
  const { meta } = router.currentRoute.value
  if (!activo && !meta.publica) router.push({ name: meta.tutor ? 'tutor-login' : 'login' })
})

export default router
