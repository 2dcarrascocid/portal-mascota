import { ref } from 'vue'
import { api, mensajeError } from '../services/api'

// Estado + CRUD para un recurso REST del backend (GET/POST ruta, PUT/DELETE ruta/:id).
// `lista` e `item` son las claves de la respuesta ({ sucursales: [...] }, { sucursal: {...} }).
export function crearRecurso({ ruta, lista, item }) {
  const items = ref([])
  const cargando = ref(false)
  const error = ref('')

  async function cargar(params) {
    cargando.value = true
    error.value = ''
    try {
      const { data } = await api.get(ruta, { params })
      items.value = data[lista]
    } catch (err) {
      error.value = mensajeError(err)
    } finally {
      cargando.value = false
    }
  }

  async function crear(datos) {
    const { data } = await api.post(ruta, datos)
    items.value.push(data[item])
    return data[item]
  }

  async function actualizar(id, datos) {
    const { data } = await api.put(`${ruta}/${id}`, datos)
    items.value = items.value.map((x) => (x.id === id ? data[item] : x))
    return data[item]
  }

  async function eliminar(id) {
    await api.delete(`${ruta}/${id}`)
    items.value = items.value.filter((x) => x.id !== id)
  }

  return { items, cargando, error, cargar, crear, actualizar, eliminar }
}
