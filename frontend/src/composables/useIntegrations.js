import { api } from '../services/api'
import { crearRecurso } from './recurso'

// Credenciales OAuth2 (client credentials) con que los servicios externos
// se conectan a la API /api/v1 (solo ORG_ADMIN). El client_secret llega
// únicamente en la respuesta de crear; después no se puede volver a ver.
const credenciales = crearRecurso({ ruta: '/integraciones/credenciales', lista: 'credenciales', item: 'credencial' })

// Devuelve la credencial con su client_secret (para mostrarlo una vez).
async function crear(datos) {
  const { data } = await api.post('/integraciones/credenciales', datos)
  const { client_secret, ...guardada } = data.credencial
  credenciales.items.value = [guardada, ...credenciales.items.value]
  return data.credencial
}

// Revocar no borra: la credencial queda en el listado como revocada.
async function revocar(id) {
  await api.delete(`/integraciones/credenciales/${id}`)
  const ahora = new Date().toISOString()
  credenciales.items.value = credenciales.items.value.map((c) => (c.id === id ? { ...c, revoked_at: ahora } : c))
}

// URL base de la API para los servicios externos.
const urlApi = `${String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')}/api/v1`

export function useIntegrations() {
  const { items, cargando, error, cargar } = credenciales
  return { items, cargando, error, cargar, crear, revocar, urlApi }
}
