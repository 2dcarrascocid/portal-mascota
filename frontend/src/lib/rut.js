// RUT chileno: validación (módulo 11) y formato. El backend guarda la forma
// canónica '12345678-9'; en pantalla se muestra '12.345.678-9'.

const limpiar = (valor) => String(valor ?? '').replace(/[.\s-]/g, '').toUpperCase()

function digitoVerificador(cuerpo) {
  let suma = 0
  let factor = 2
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  const resto = 11 - (suma % 11)
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)
}

export function rutValido(valor) {
  const t = limpiar(valor)
  return /^\d{7,8}[\dK]$/.test(t) && digitoVerificador(t.slice(0, -1)) === t.slice(-1)
}

// '123456785' | '12345678-5' -> '12.345.678-5' (lo que no se reconoce queda igual).
export function formatearRut(valor) {
  const t = limpiar(valor)
  if (t.length < 2 || !/^\d+[\dK]$/.test(t)) return valor ?? ''
  const cuerpo = t.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cuerpo}-${t.slice(-1)}`
}
