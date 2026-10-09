import { crearRecurso } from './recurso'

// Catálogo de especialidades de la organización (se asignan al personal).
const especialidades = crearRecurso({ ruta: '/especialidades', lista: 'especialidades', item: 'especialidad' })

export function useSpecialties() {
  return especialidades
}
