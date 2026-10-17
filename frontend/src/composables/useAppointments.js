import { api } from '../services/api'
import { crearRecurso } from './recurso'

// Citas reservadas. cargar({ desde, hasta, branchId, staffId, estado, q }) filtra.
const citas = crearRecurso({ ruta: '/citas', lista: 'citas', item: 'cita' })

function reemplazar(cita) {
  citas.items.value = citas.items.value.map((c) => (c.id === cita.id ? cita : c))
}

// { status, reason? }
async function cambiarEstado(id, datos) {
  const { data } = await api.put(`/citas/${id}/estado`, datos)
  reemplazar(data.cita)
  return data.cita
}

// Turnos libres: [{ fecha, dia, agendas: [{ staff_id, branch_id, turnos: [{ inicio, fin, origen }] }] }]
// params: { desde, hasta, branchId, staffId, cargo, specialtyId, serviceId }
export async function turnosDisponibles(params) {
  const { data } = await api.get('/citas/disponibles', { params })
  return data.dias
}

// Búsqueda de tutores (con mascotas) sin tocar el listado de la pantalla Tutores.
export async function buscarTutores(q) {
  const { data } = await api.get('/tutores', { params: q ? { q } : {} })
  return data.tutores
}

export function useAppointments() {
  return { ...citas, cambiarEstado }
}
