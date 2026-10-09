import { computed, ref } from 'vue'
import { api, sesionStorage, onSesionExpirada } from '../services/api'

// Estado compartido por toda la app (módulo singleton).
// La redirección a /login al cerrar sesión la hace el router observando `autenticado`.
const usuario = ref(null) // { id, email }
const perfil = ref(null)
const organizacion = ref(null)
const cargado = ref(false)

// Copia del último /auth/me para arrancar sin red (offline-first).
const CLAVE_CACHE = 'pc_usuario'

function aplicar({ usuario: u, perfil: p, organizacion: o }) {
  usuario.value = u
  perfil.value = p
  organizacion.value = o ?? null
  try {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify({ usuario: u, perfil: p, organizacion: o }))
  } catch {
    // almacenamiento lleno o bloqueado: seguimos sin cache
  }
}

function limpiar() {
  sesionStorage.clear()
  localStorage.removeItem(CLAVE_CACHE)
  usuario.value = null
  perfil.value = null
  organizacion.value = null
}

async function cargarUsuario() {
  if (!sesionStorage.get()) return limpiar()
  try {
    const { data } = await api.get('/auth/me')
    aplicar(data)
  } catch (err) {
    // Sesión rechazada; otros errores (500, sin red) no cierran la sesión.
    if (err.response?.status === 401) return limpiar()
    // Usamos lo último conocido.
    try {
      const cache = JSON.parse(localStorage.getItem(CLAVE_CACHE))
      if (cache) aplicar(cache)
    } catch {
      // cache corrupta: queda sin usuario
    }
  }
}

// Carga la sesión guardada una sola vez (la espera el guard del router).
let iniciando
function iniciar() {
  iniciando ??= cargarUsuario().finally(() => {
    cargado.value = true
  })
  return iniciando
}

function iniciarSesion({ sesion, ...datos }) {
  sesionStorage.set(sesion)
  aplicar(datos)
}

async function loginConEmail(email, password) {
  const { data } = await api.post('/auth/login', { email, password })
  iniciarSesion(data)
}

// Devuelve { requiereConfirmacion } cuando el proyecto exige confirmar el email.
async function registrarConEmail({ email, password, fullName, organizationId }) {
  const { data } = await api.post('/auth/registro', { email, password, fullName, organizationId })
  if (data.requiereConfirmacion) return { requiereConfirmacion: true }
  iniciarSesion(data)
  return { requiereConfirmacion: false }
}

// Link del correo de confirmación: confirma el email e inicia sesión.
async function verificarEmail(token) {
  const { data } = await api.post('/auth/verificar', { token })
  iniciarSesion(data)
}

async function reenviarVerificacion(email) {
  const { data } = await api.post('/auth/reenviar-verificacion', { email })
  return data.mensaje
}

async function recuperarPassword(email) {
  const { data } = await api.post('/auth/recuperar', { email })
  return data.mensaje
}

// Link del correo de recuperación: nueva contraseña e inicia sesión.
async function restablecerPassword(token, password) {
  const { data } = await api.post('/auth/restablecer', { token, password })
  iniciarSesion(data)
}

// provider: 'google' | 'facebook'. El backend redirige al proveedor y, al
// volver, deja la sesión en el fragmento (#) de /auth/callback.
function loginConProveedor(provider, redirect) {
  const url = new URL(`${import.meta.env.VITE_API_URL}/auth/oauth/${provider}`)
  if (redirect) url.searchParams.set('redirect', redirect)
  window.location.assign(url)
}

// Recibe los tokens que el backend deja en /auth/callback#access_token=...
async function completarCallback(fragmento) {
  const p = new URLSearchParams(fragmento.replace(/^#/, ''))
  const error = p.get('error_description') || p.get('error')
  if (error) throw new Error(error)
  if (!p.get('access_token') || !p.get('refresh_token')) {
    throw new Error('El enlace expiró o no es válido')
  }
  sesionStorage.set({
    access_token: p.get('access_token'),
    refresh_token: p.get('refresh_token'),
    expires_at: Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(p.get('expires_in') || 0),
  })
  await cargarUsuario()
  if (!usuario.value) throw new Error('No se pudo iniciar sesión')
}

async function logout() {
  try {
    const refresh = sesionStorage.get()?.refresh_token
    if (refresh) await api.post('/auth/logout', { refresh_token: refresh })
  } catch {
    // sin red o token vencido: igual cerramos la sesión local
  } finally {
    limpiar()
  }
}

onSesionExpirada(limpiar)

async function listarOrganizacionesPublicas() {
  const { data } = await api.get('/organizaciones/publicas')
  return data.organizaciones
}

async function unirseAOrganizacion(organizationId) {
  const { data } = await api.post('/organizaciones/unirse', { organizationId })
  aplicar(data)
}

async function crearOrganizacion(datos) {
  const { data } = await api.post('/organizaciones', datos)
  aplicar(data)
}

export function useAuth() {
  return {
    usuario,
    perfil,
    organizacion,
    cargado,
    autenticado: computed(() => !!usuario.value),
    rol: computed(() => perfil.value?.role ?? null),
    tieneOrganizacion: computed(() => !!perfil.value?.organization_id),
    // El SUPER_ADMIN opera sobre todas las entidades y no necesita una propia.
    necesitaEntidad: computed(
      () => !!usuario.value && !perfil.value?.organization_id && perfil.value?.role !== 'SUPER_ADMIN'
    ),
    esAdmin: computed(() => ['SUPER_ADMIN', 'ORG_ADMIN'].includes(perfil.value?.role)),
    // Módulo de estructura: administra solo el ORG_ADMIN; el resto del personal consulta.
    esAdminOrg: computed(() => perfil.value?.role === 'ORG_ADMIN'),
    esPersonal: computed(() => ['ORG_ADMIN', 'VET', 'GROOMER', 'TRAINER'].includes(perfil.value?.role)),
    iniciar,
    cargarUsuario,
    loginConEmail,
    registrarConEmail,
    loginConProveedor,
    completarCallback,
    verificarEmail,
    reenviarVerificacion,
    recuperarPassword,
    restablecerPassword,
    logout,
    listarOrganizacionesPublicas,
    unirseAOrganizacion,
    crearOrganizacion,
  }
}
