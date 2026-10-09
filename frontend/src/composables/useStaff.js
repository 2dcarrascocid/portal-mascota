import { ref } from 'vue'
import { api, mensajeError } from '../services/api'

// Mantenedor de personal: miembros de la organización y su asignación a sucursales.
const personal = ref([])
const cargando = ref(false)
const error = ref('')

async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    const { data } = await api.get('/personal')
    personal.value = data.personal
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
}

function reemplazar(integrante) {
  const existe = personal.value.some((p) => p.id === integrante.id)
  personal.value = existe
    ? personal.value.map((p) => (p.id === integrante.id ? integrante : p))
    : [...personal.value, integrante]
}

// Crea la cuenta (o suma una existente) e invita por correo.
// Devuelve { integrante, correoEnviado, cuentaExistente }.
async function crear(datos) {
  const { data } = await api.post('/personal', datos)
  reemplazar(data.integrante)
  return data
}

// Datos + rol; las sucursales van aparte.
async function actualizar(id, datos) {
  const { data } = await api.put(`/personal/${id}`, datos)
  reemplazar(data.integrante)
}

async function asignarSucursales(id, branchIds) {
  const { data } = await api.put(`/personal/${id}/sucursales`, { branchIds })
  personal.value = personal.value.map((p) => (p.id === id ? { ...p, branch_ids: data.branch_ids } : p))
}

async function cambiarEstado(id, activo) {
  const { data } = await api.put(`/personal/${id}/estado`, { activo })
  reemplazar(data.integrante)
}

async function reenviarInvitacion(id) {
  await api.post(`/personal/${id}/invitacion`)
}

async function quitar(id) {
  await api.delete(`/personal/${id}`)
  personal.value = personal.value.filter((p) => p.id !== id)
}

export function useStaff() {
  return { personal, cargando, error, cargar, crear, actualizar, asignarSucursales, cambiarEstado, reenviarInvitacion, quitar }
}
