import { crearRecurso } from './recurso'

// Sucursales de la organización (el especialista solo recibe las asignadas).
const sucursales = crearRecurso({ ruta: '/sucursales', lista: 'sucursales', item: 'sucursal' })

export function useBranches() {
  return sucursales
}
