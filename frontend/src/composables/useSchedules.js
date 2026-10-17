import { api } from '../services/api'
import { crearRecurso } from './recurso'

// Bloques semanales de atención. cargar({ branchId, staffId }) filtra.
const agendas = crearRecurso({ ruta: '/agendas', lista: 'agendas', item: 'agenda' })

// Excepciones: bloqueos, horarios extra y cambios de horario.
// cargar({ desde, hasta, branchId, staffId }) filtra.
const excepciones = crearRecurso({ ruta: '/agendas/excepciones', lista: 'excepciones', item: 'excepcion' })

// Copia los bloques semanales de un profesional a otro (misma sucursal).
async function copiar(datos) {
  const { data } = await api.post('/agendas/copiar', datos)
  agendas.items.value.push(...data.agendas)
  return data.agendas
}

// Traslada la atención de un día a otro (bloqueo + horarios extra).
async function moverDia(datos) {
  const { data } = await api.post('/agendas/mover-dia', datos)
  excepciones.items.value.push(...data.excepciones)
  return data.excepciones
}

// Turnos resultantes por día: [{ fecha, dia, agendas: [{ staff_id, branch_id, turnos, bloqueos }] }]
async function disponibilidad(params) {
  const { data } = await api.get('/agendas/disponibilidad', { params })
  return data.dias
}

export function useSchedules() {
  return { ...agendas, copiar }
}

export function useScheduleExceptions() {
  return { ...excepciones, moverDia }
}

export { disponibilidad }
