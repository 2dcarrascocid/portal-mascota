import { ref } from 'vue'
import { api, mensajeError } from '../services/api'

// Especies con sus razas: catálogo base (propia: false) + las de la organización.
const especies = ref([])
const cargando = ref(false)
const error = ref('')

async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    const { data } = await api.get('/especies')
    especies.value = data.especies
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
}

const porNombre = (a, b) => a.name.localeCompare(b.name, 'es')

async function crearEspecie(name) {
  const { data } = await api.post('/especies', { name })
  especies.value = [...especies.value, data.especie].sort(porNombre)
}

async function eliminarEspecie(id) {
  await api.delete(`/especies/${id}`)
  especies.value = especies.value.filter((e) => e.id !== id)
}

async function crearRaza(especieId, name) {
  const { data } = await api.post(`/especies/${especieId}/razas`, { name })
  especies.value = especies.value.map((e) =>
    e.id === especieId ? { ...e, razas: [...e.razas, data.raza].sort(porNombre) } : e
  )
}

async function eliminarRaza(especieId, razaId) {
  await api.delete(`/razas/${razaId}`)
  especies.value = especies.value.map((e) =>
    e.id === especieId ? { ...e, razas: e.razas.filter((r) => r.id !== razaId) } : e
  )
}

const razasDe = (especieId) => especies.value.find((e) => e.id === especieId)?.razas ?? []

export function useSpecies() {
  return { especies, cargando, error, cargar, crearEspecie, eliminarEspecie, crearRaza, eliminarRaza, razasDe }
}
