import { ref } from 'vue'
import { api, mensajeError } from '../services/api'
import { crearRecurso } from './recurso'

// Roles configurables (solo ORG_ADMIN). GET /roles trae además el catálogo
// de permisos: { modulos: [{ clave, nombre, grupo }], acciones, basicos }.
const roles = crearRecurso({ ruta: '/roles', lista: 'roles', item: 'rol' })
const catalogo = ref({ modulos: [], acciones: [], basicos: [] })

async function cargar() {
  roles.cargando.value = true
  roles.error.value = ''
  try {
    const { data } = await api.get('/roles')
    roles.items.value = data.roles
    catalogo.value = data.catalogo
  } catch (err) {
    roles.error.value = mensajeError(err)
  } finally {
    roles.cargando.value = false
  }
}

export function useRoles() {
  return { ...roles, catalogo, cargar }
}
