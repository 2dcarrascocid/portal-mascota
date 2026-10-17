import { ref } from 'vue'
import { ROLES_PERSONAL } from '../lib/catalogos'
import { api, mensajeError } from '../services/api'

// Recepción del día: citas (con su atención, si ya llegó) y atenciones.
// Cada acción sobre una atención devuelve la atención completa (con
// prestaciones, pagos y totales) y se reemplaza en la lista.
const fecha = ref('')
const citas = ref([])
const atenciones = ref([])
const sinSucursal = ref(false) // el usuario no tiene sucursal asignada
const cargando = ref(false)
const error = ref('')

async function cargar(params) {
  cargando.value = true
  error.value = ''
  try {
    const { data } = await api.get('/recepcion', { params })
    fecha.value = data.fecha
    citas.value = data.citas
    atenciones.value = data.atenciones
    sinSucursal.value = !!data.sinSucursal
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
}

function reemplazar(atencion) {
  const existe = atenciones.value.some((a) => a.id === atencion.id)
  atenciones.value = existe
    ? atenciones.value.map((a) => (a.id === atencion.id ? atencion : a))
    : [...atenciones.value, atencion]
  // La cita refleja su atención vigente (y su estado).
  if (atencion.appointment_id) {
    citas.value = citas.value.map((c) => {
      if (c.id !== atencion.appointment_id) return c
      const vigente = atencion.status !== 'ANULADA'
      const status = { ABIERTA: 'LLEGO', CERRADA: 'ATENDIDA', ANULADA: 'RESERVADA' }[atencion.status]
      return { ...c, status, visit: vigente ? { id: atencion.id, status: atencion.status } : null }
    })
  }
  return atencion
}

const con = (peticion) => peticion.then(({ data }) => reemplazar(data.atencion))

export function useReception() {
  return {
    fecha,
    citas,
    atenciones,
    sinSucursal,
    cargando,
    error,
    cargar,
    // Llegada de una cita o atención espontánea ({ branch_id, client_id?, pet_id?, contact_name?, ... })
    recibir: (datos) => con(api.post('/atenciones', datos)),
    obtener: (id) => con(api.get(`/atenciones/${id}`)),
    actualizar: (id, datos) => con(api.put(`/atenciones/${id}`, datos)),
    agregarPrestacion: (id, datos) => con(api.post(`/atenciones/${id}/prestaciones`, datos)),
    quitarPrestacion: (id, itemId) => con(api.delete(`/atenciones/${id}/prestaciones/${itemId}`)),
    registrarPago: (id, datos) => con(api.post(`/atenciones/${id}/pagos`, datos)),
    quitarPago: (id, pagoId) => con(api.delete(`/atenciones/${id}/pagos/${pagoId}`)),
    cerrar: (id) => con(api.post(`/atenciones/${id}/cerrar`)),
    anular: (id, reason) => con(api.post(`/atenciones/${id}/anular`, { reason })),
  }
}

// Personal que atiende en esas sucursales: activo, asignado a alguna de
// ellas y con al menos una especialidad.
export const atiendenEn = (personal, branchIds) =>
  personal.filter(
    (p) =>
      p.activo &&
      ROLES_PERSONAL.includes(p.role) &&
      p.specialty_ids?.length &&
      p.branch_ids?.some((b) => branchIds.includes(b))
  )

// Especialidades que tiene al menos uno de esos profesionales.
export const especialidadesDe = (profesionales, especialidades) =>
  especialidades.filter((e) => profesionales.some((p) => p.specialty_ids.includes(e.id)))

// $12.990 (pesos chilenos, sin decimales si no los tiene)
export const pesos = (n) =>
  Number(n || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 2 })
