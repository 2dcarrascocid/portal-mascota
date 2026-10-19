// Etiquetas de los enums de la base de datos (user_role, organization_type).
export const ROLES = {
  SUPER_ADMIN: 'Super admin',
  ORG_ADMIN: 'Administrador',
  STAFF: 'Personal',
  VET: 'Veterinario/a',
  GROOMER: 'Peluquero/a',
  TRAINER: 'Adiestrador/a',
  CLIENT: 'Cliente',
}

export const TIPOS_ORGANIZACION = {
  PRIVATE_COMPANY: 'Empresa privada',
  MUNICIPALITY: 'Municipalidad',
  INDEPENDENT: 'Independiente',
}

export const CATEGORIAS_SERVICIO = {
  GROOMING: 'Peluquería',
  VET: 'Veterinaria',
  TRAINING: 'Adiestramiento',
}

// schedule_exception_type
export const TIPOS_EXCEPCION = {
  BLOQUEO: 'Bloqueo',
  HORARIO_EXTRA: 'Horario extra',
  CAMBIO_HORARIO: 'Cambio de horario',
}

// appointment_status
export const ESTADOS_CITA = {
  RESERVADA: 'Reservada',
  CONFIRMADA: 'Confirmada',
  LLEGO: 'Llegó',
  ATENDIDA: 'Atendida',
  NO_ASISTIO: 'No asistió',
  CANCELADA: 'Cancelada',
}

// visit_status
export const ESTADOS_ATENCION = {
  ABIERTA: 'En atención',
  CERRADA: 'Cerrada',
  ANULADA: 'Anulada',
}

// payment_method
export const MEDIOS_PAGO = {
  EFECTIVO: 'Efectivo',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  TRANSFERENCIA: 'Transferencia',
  WEBPAY: 'Webpay (internet)',
  OTRO: 'Otro medio',
}

// Agrupación de los medios de pago en la cuadratura de caja (igual que la
// RPC cash_day_summary; `clave` = campo del resumen y prefijo del cierre).
export const CATEGORIAS_CAJA = [
  { clave: 'cash', texto: 'Efectivo', medios: ['EFECTIVO'] },
  { clave: 'card', texto: 'Tarjetas', medios: ['DEBITO', 'CREDITO'] },
  { clave: 'online', texto: 'Internet', medios: ['TRANSFERENCIA', 'WEBPAY'] },
  { clave: 'other', texto: 'Otros medios', medios: ['OTRO'] },
]

// day_of_week de la base: 0 = domingo
export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

// Orden de la semana para mostrar (lunes primero)
export const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0]

// Roles que puede asignar un ORG_ADMIN (SUPER_ADMIN no)
export const ROLES_ASIGNABLES = ['ORG_ADMIN', 'STAFF', 'VET', 'GROOMER', 'TRAINER', 'CLIENT']

// STAFF: personal sin cargo; VET/GROOMER/TRAINER quedan para el personal antiguo.
export const ROLES_PERSONAL = ['ORG_ADMIN', 'STAFF', 'VET', 'GROOMER', 'TRAINER']
