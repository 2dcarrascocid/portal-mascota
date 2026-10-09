import { crearRecurso } from './recurso'

// Catálogo de servicios. cargar({ category: 'GROOMING' }) filtra por tipo.
const servicios = crearRecurso({ ruta: '/servicios', lista: 'servicios', item: 'servicio' })

export function useServices() {
  return servicios
}
