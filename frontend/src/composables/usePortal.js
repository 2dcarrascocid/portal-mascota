import { ref } from 'vue'
import { api } from '../services/api'

// Portal del tutor: perfil, mascotas, sucursales cercanas, reservas e historial.
// Estado compartido entre las vistas de /mi (módulo singleton).
const perfil = ref(null)
const perfilCompleto = ref(false)
const mascotas = ref([])

async function cargarPerfil() {
  const { data } = await api.get('/portal/perfil')
  perfil.value = data.perfil
  perfilCompleto.value = data.completo
  return data
}

async function guardarPerfil(datos) {
  const { data } = await api.put('/portal/perfil', datos)
  perfil.value = data.perfil
  perfilCompleto.value = data.completo
  return data.perfil
}

async function cargarMascotas() {
  const { data } = await api.get('/portal/mascotas')
  mascotas.value = data.mascotas
  return data.mascotas
}

const porNombre = (a, b) => a.name.localeCompare(b.name, 'es')

async function crearMascota(datos) {
  const { data } = await api.post('/portal/mascotas', datos)
  mascotas.value = [...mascotas.value, data.mascota].sort(porNombre)
  return data.mascota
}

async function actualizarMascota(id, datos) {
  const { data } = await api.put(`/portal/mascotas/${id}`, datos)
  mascotas.value = mascotas.value.map((m) => (m.id === id ? data.mascota : m)).sort(porNombre)
  return data.mascota
}

async function eliminarMascota(id) {
  await api.delete(`/portal/mascotas/${id}`)
  mascotas.value = mascotas.value.filter((m) => m.id !== id)
}

// punto: { latitude, longitude } | null (null = la dirección del perfil)
async function buscarSucursales({ punto, q } = {}) {
  const params = {}
  if (punto) Object.assign(params, { lat: punto.latitude, lng: punto.longitude })
  if (q) params.q = q
  const { data } = await api.get('/portal/sucursales', { params })
  return data // { punto, sucursales }
}

async function obtenerSucursal(id) {
  const { data } = await api.get(`/portal/sucursales/${id}`)
  return data // { sucursal, servicios }
}

async function disponibles(params) {
  const { data } = await api.get('/portal/disponibles', { params })
  return data // { dias, profesionales }
}

async function listarCitas() {
  const { data } = await api.get('/portal/citas')
  return data.citas
}

// -> { cita, pago? }  (pago = { url, token } para ir a Webpay)
async function reservar(datos) {
  const { data } = await api.post('/portal/citas', datos)
  return data
}

async function pagarCita(id) {
  const { data } = await api.post(`/portal/citas/${id}/pago`)
  return data.pago
}

async function cancelarCita(id) {
  const { data } = await api.post(`/portal/citas/${id}/cancelar`)
  return data.cita
}

async function historial(params) {
  const { data } = await api.get('/portal/historial', { params })
  return data.atenciones
}

export function usePortal() {
  return {
    perfil,
    perfilCompleto,
    mascotas,
    cargarPerfil,
    guardarPerfil,
    cargarMascotas,
    crearMascota,
    actualizarMascota,
    eliminarMascota,
    buscarSucursales,
    obtenerSucursal,
    disponibles,
    listarCitas,
    reservar,
    pagarCita,
    cancelarCita,
    historial,
  }
}
