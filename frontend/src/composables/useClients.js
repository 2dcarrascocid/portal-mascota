import { ref } from 'vue'
import { api, mensajeError } from '../services/api'

// Tutores (con sus mascotas) de la organización.
const tutores = ref([])
const cargando = ref(false)
const error = ref('')

async function buscar(q = '') {
  cargando.value = true
  error.value = ''
  try {
    const { data } = await api.get('/tutores', { params: q ? { q } : {} })
    tutores.value = data.tutores
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
}

function reemplazar(tutor) {
  const existe = tutores.value.some((t) => t.id === tutor.id)
  tutores.value = existe ? tutores.value.map((t) => (t.id === tutor.id ? tutor : t)) : [tutor, ...tutores.value]
}

// Registro unificado: tutor + mascotas en una sola transacción.
async function crearConMascotas(tutor, mascotas) {
  const { data } = await api.post('/tutores', { tutor, mascotas })
  reemplazar(data.tutor)
  return data.tutor
}

async function actualizar(id, tutor) {
  const { data } = await api.put(`/tutores/${id}`, tutor)
  reemplazar(data.tutor)
}

async function eliminar(id) {
  await api.delete(`/tutores/${id}`)
  tutores.value = tutores.value.filter((t) => t.id !== id)
}

function cambiarMascotas(clientId, fn) {
  tutores.value = tutores.value.map((t) => (t.id === clientId ? { ...t, pets: fn(t.pets) } : t))
}

async function agregarMascota(clientId, mascota) {
  const { data } = await api.post(`/tutores/${clientId}/mascotas`, mascota)
  cambiarMascotas(clientId, (pets) => [...pets, data.mascota])
}

async function actualizarMascota(clientId, id, mascota) {
  const { data } = await api.put(`/mascotas/${id}`, mascota)
  cambiarMascotas(clientId, (pets) => pets.map((p) => (p.id === id ? data.mascota : p)))
}

async function eliminarMascota(clientId, id) {
  await api.delete(`/mascotas/${id}`)
  cambiarMascotas(clientId, (pets) => pets.filter((p) => p.id !== id))
}

export function useClients() {
  return {
    tutores,
    cargando,
    error,
    buscar,
    crearConMascotas,
    actualizar,
    eliminar,
    agregarMascota,
    actualizarMascota,
    eliminarMascota,
  }
}
