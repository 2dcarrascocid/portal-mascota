// Fechas 'AAAA-MM-DD' en hora local (las que usan agendas y excepciones).

const dosDigitos = (n) => String(n).padStart(2, '0')
const aTexto = (d) => `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`
const aFecha = (texto) => {
  const [a, m, d] = texto.split('-').map(Number)
  return new Date(a, m - 1, d)
}

export const hoy = () => aTexto(new Date())

export function sumarDias(texto, dias) {
  const d = aFecha(texto)
  d.setDate(d.getDate() + dias)
  return aTexto(d)
}

// Lunes de la semana de la fecha.
export function lunesDe(texto) {
  const d = aFecha(texto)
  return sumarDias(texto, -((d.getDay() + 6) % 7))
}

// "lun 12 oct" / con año: "12 oct 2026"
export function fechaCorta(texto, { anio = false, dia = true } = {}) {
  if (!texto) return ''
  return aFecha(texto).toLocaleDateString('es-CL', {
    ...(dia && { weekday: 'short' }),
    day: 'numeric',
    month: 'short',
    ...(anio && { year: 'numeric' }),
  })
}

// "12 oct – 15 oct 2026" (o un solo día)
export function rangoFechas(desde, hasta) {
  if (!hasta || desde === hasta) return fechaCorta(desde, { anio: true })
  return `${fechaCorta(desde, { dia: false })} – ${fechaCorta(hasta, { anio: true, dia: false })}`
}

export const hhmm = (t) => t?.slice(0, 5)
