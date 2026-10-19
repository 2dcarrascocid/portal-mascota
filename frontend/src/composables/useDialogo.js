import { computed, ref } from 'vue'

// Diálogos con el usuario (reemplazan alert/confirm/prompt del navegador).
// Los muestra un único componente, DialogoGlobal (montado en App.vue); cada
// llamada devuelve una promesa que se resuelve con la respuesta:
//   await confirmar({ titulo, mensaje, detalle?, aceptar?, peligro? })  -> true | false
//   await pedirTexto({ titulo, mensaje?, etiqueta?, valor?, requerido?, max? }) -> texto | null
//   await avisar({ titulo, mensaje })                                    -> (al cerrar)
// También aceptan solo el mensaje: confirmar('¿Seguro?').
// Si llegan varios a la vez, se muestran en orden.
const cola = ref([])
const actual = computed(() => cola.value[0] ?? null)
let siguiente = 0

function abrir(tipo, opciones, porDefecto) {
  const datos = typeof opciones === 'string' ? { mensaje: opciones } : opciones
  return new Promise((resolver) => {
    cola.value = [...cola.value, { id: ++siguiente, tipo, ...datos, resolver, porDefecto }]
  })
}

// Respuesta del componente; sin valor = cancelar (Esc, ×, clic fuera).
function responder(valor) {
  const dialogo = actual.value
  if (!dialogo) return
  cola.value = cola.value.slice(1)
  dialogo.resolver(valor === undefined ? dialogo.porDefecto : valor)
}

export const confirmar = (opciones) => abrir('confirmar', opciones, false)
export const pedirTexto = (opciones) => abrir('texto', opciones, null)
export const avisar = (opciones) => abrir('aviso', opciones, undefined)

export function useDialogo() {
  return { actual, responder, confirmar, pedirTexto, avisar }
}
