import { crearRecurso } from './recurso'

// Bloques semanales de atención. cargar({ branchId, staffId }) filtra.
const agendas = crearRecurso({ ruta: '/agendas', lista: 'agendas', item: 'agenda' })

export function useSchedules() {
  return agendas
}
