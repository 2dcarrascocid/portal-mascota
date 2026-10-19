import { ref } from 'vue'
import { api, mensajeError } from '../services/api'

// Caja de una sucursal en un día: { fecha, hoy, branch_id, resumen, pagos, cierre }.
// resumen = { by_method, cash, card, online, other, total, count, pending,
//             pending_count, pending_amount } (con la caja cerrada, la foto del cierre).
const caja = ref(null)
const cierres = ref([]) // historial de la sucursal
const cargando = ref(false)
const error = ref('')

// Solo la última consulta actualiza (al cambiar rápido de sucursal o fecha).
let consulta = 0

async function cargar({ branchId, fecha }) {
  const n = ++consulta
  cargando.value = true
  error.value = ''
  try {
    const { data } = await api.get('/caja', { params: { branchId, fecha } })
    if (n === consulta) caja.value = data
  } catch (err) {
    if (n === consulta) error.value = mensajeError(err)
  } finally {
    if (n === consulta) cargando.value = false
  }
}

async function cargarCierres(params) {
  try {
    const { data } = await api.get('/caja/cierres', { params })
    cierres.value = data.cierres
  } catch {
    cierres.value = [] // el historial es complementario: no bloquea la caja
  }
}

const aplicar = ({ data }) => (caja.value = data)

export function useCashbox() {
  return {
    caja,
    cierres,
    cargando,
    error,
    cargar,
    cargarCierres,
    // { branch_id, date, opening_cash?, cash_counted?, card_counted?, online_counted?, other_counted?, notes? }
    cerrar: (datos) => api.post('/caja/cierres', datos).then(aplicar),
    reabrir: (id) => api.delete(`/caja/cierres/${id}`).then(aplicar),
    // Cobro de una atención pendiente (sin tocar el estado de Recepción).
    obtenerAtencion: (id) => api.get(`/atenciones/${id}`).then(({ data }) => data.atencion),
    registrarPago: (id, datos) => api.post(`/atenciones/${id}/pagos`, datos).then(({ data }) => data.atencion),
  }
}
