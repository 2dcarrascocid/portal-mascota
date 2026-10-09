import axios from 'axios'

const baseURL = import.meta.env.VITE_API_URL
const CLAVE_SESION = 'pc_sesion'

// Sesión emitida por el backend: { access_token, refresh_token, expires_at }.
// El frontend no tiene keys de Supabase; todo pasa por la API.
export const sesionStorage = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(CLAVE_SESION))
    } catch {
      return null
    }
  },
  set: (sesion) => localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion)),
  clear: () => localStorage.removeItem(CLAVE_SESION),
}

export const api = axios.create({ baseURL, timeout: 15000 })

// Callback que registra useAuth para cerrar sesión cuando ya no se puede renovar.
let alExpirarSesion = () => {}
export function onSesionExpirada(fn) {
  alExpirarSesion = fn
}

// Renueva el access token una sola vez aunque haya varias peticiones esperando.
let renovando = null
function renovarSesion() {
  renovando ??= axios
    .post(`${baseURL}/auth/refresh`, { refresh_token: sesionStorage.get()?.refresh_token }, { timeout: 15000 })
    .then(({ data }) => {
      sesionStorage.set(data.sesion)
      return data.sesion
    })
    .catch((err) => {
      // Rechazo del backend = sesión inválida. Sin red se conserva (offline-first).
      if (err.response) alExpirarSesion()
      throw err
    })
    .finally(() => {
      renovando = null
    })
  return renovando
}

const porVencer = (sesion) => sesion.expires_at * 1000 - Date.now() < 60_000

api.interceptors.request.use(async (config) => {
  let sesion = sesionStorage.get()
  if (sesion?.refresh_token && porVencer(sesion) && navigator.onLine) {
    sesion = await renovarSesion().catch(() => sesionStorage.get())
  }
  if (sesion?.access_token) config.headers.Authorization = `Bearer ${sesion.access_token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const { config, response } = err
    if (response?.status !== 401 || !sesionStorage.get()) return Promise.reject(err)

    // Token revocado o vencido: un reintento tras renovar.
    if (!config._reintento) {
      config._reintento = true
      try {
        await renovarSesion()
        return api(config)
      } catch {
        return Promise.reject(err)
      }
    }
    alExpirarSesion()
    return Promise.reject(err)
  }
)

// Mensaje legible a partir de un error de axios.
export function mensajeError(err) {
  return err?.response?.data?.error || err?.message || 'Error inesperado'
}
