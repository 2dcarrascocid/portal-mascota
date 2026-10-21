// Catálogo de la API /api/v1 para servicios externos (contactabilidad), que
// se muestra en Configuración → Integraciones. Debe calzar con
// backend/src/functions/contactabilidad.js y con el contrato
// docs/contactabilidad/api-integracion-core.md.
//   ruta       -> relativa a la URL base (…/api/v1)
//   parametros -> query o path: { nombre, en, tipo, obligatorio, descripcion }
//   cuerpo     -> ejemplo del body (objeto = JSON; texto = tal cual)
//   campos     -> descripción de los campos del body
//   respuestas -> [{ codigo, descripcion, ejemplo? }]

const CITA_EJEMPLO = {
  id: '6f1c2d4e-8a1b-4c3d-9e2f-1a2b3c4d5e6f',
  fecha: '2026-10-22',
  hora_inicio: '10:30',
  hora_fin: '11:00',
  estado: 'RESERVADA',
  pago: null,
  confirmada_at: null,
  canal_confirmacion: null,
  sucursal: { id: '…', nombre: 'Maipú', direccion: 'Av. Pajaritos 2100, Maipú', telefono: '+56 2 2567 8901' },
  profesional: { id: '…', nombre: 'Ignacio Pérez' },
  servicio: { id: '…', nombre: 'Consulta general' },
  especialidad: { id: '…', nombre: 'Medicina general' },
  mascota: { id: '…', nombre: 'Firulais' },
  tutor: {
    nombre: 'María Pérez',
    telefono: '9 8765 4321',
    telefono_e164: '+56987654321',
    email: 'maria@ejemplo.cl',
    rut_enmascarado: '12.***.***-5',
  },
}

const CANAL = { nombre: 'canal', tipo: 'texto', obligatorio: false, descripcion: 'WHATSAPP, SMS, EMAIL, VOZ o LLAMADA.' }
const ID_EXTERNO = {
  nombre: 'id_externo',
  tipo: 'texto (máx. 120)',
  obligatorio: false,
  descripcion: 'Id del evento en el motor. Recomendado: repetir la llamada con el mismo valor no aplica el cambio dos veces.',
}
const ID_CITA = { nombre: 'id', en: 'ruta', tipo: 'UUID', obligatorio: true, descripcion: 'Id de la cita (de la nómina).' }

const ERROR_401 = { codigo: 401, descripcion: 'Token ausente, vencido o credencial revocada: pedir un token nuevo.', ejemplo: { error: 'Token inválido o expirado' } }
const ERROR_404 = { codigo: 404, descripcion: 'La cita no existe o es de otra entidad.', ejemplo: { error: 'Cita no encontrada' } }

export const ENDPOINTS_INTEGRACION = [
  {
    id: 'token',
    grupo: '1. Conectividad',
    metodo: 'POST',
    ruta: '/oauth/token',
    titulo: 'Obtener token de acceso',
    descripcion:
      'OAuth2 client credentials. Cambia el Client ID y el Client secret por un token Bearer de 1 hora, que se envía en todas las demás llamadas.',
    autenticacion: 'HTTP Basic (client_id:client_secret) o client_id y client_secret en el cuerpo.',
    contentType: 'application/x-www-form-urlencoded (también JSON)',
    cuerpo: 'grant_type=client_credentials',
    campos: [
      { nombre: 'grant_type', tipo: 'texto', obligatorio: true, descripcion: 'Siempre client_credentials.' },
      { nombre: 'client_id', tipo: 'texto', obligatorio: false, descripcion: 'Solo si no se usa HTTP Basic.' },
      { nombre: 'client_secret', tipo: 'texto', obligatorio: false, descripcion: 'Solo si no se usa HTTP Basic.' },
    ],
    respuestas: [
      { codigo: 200, descripcion: 'Token emitido.', ejemplo: { access_token: 'eyJhbGciOiJIUzI1NiIs…', token_type: 'Bearer', expires_in: 3600 } },
      { codigo: 400, descripcion: 'grant_type distinto de client_credentials.', ejemplo: { error: 'unsupported_grant_type', error_description: 'Solo se admite grant_type=client_credentials' } },
      { codigo: 401, descripcion: 'Credenciales inválidas o revocadas.', ejemplo: { error: 'invalid_client', error_description: 'Credenciales inválidas o revocadas' } },
    ],
  },
  {
    id: 'programadas',
    grupo: '2. Búsqueda de citas',
    metodo: 'GET',
    ruta: '/citas/programadas',
    titulo: 'Nómina de citas a contactar',
    descripcion:
      'Citas futuras a gestionar, por defecto las RESERVADA de hoy a 7 días. Hoy solo incluye las que aún no empiezan; no incluye reservas con el pago en línea en curso.',
    parametros: [
      { nombre: 'desde', en: 'query', tipo: 'AAAA-MM-DD', obligatorio: false, descripcion: 'Por defecto, hoy.' },
      { nombre: 'hasta', en: 'query', tipo: 'AAAA-MM-DD', obligatorio: false, descripcion: 'Por defecto, desde + 7 días. Máximo 31 días.' },
      { nombre: 'estado', en: 'query', tipo: 'texto', obligatorio: false, descripcion: 'RESERVADA (defecto), CONFIRMADA o RESERVADA,CONFIRMADA.' },
      { nombre: 'sucursal', en: 'query', tipo: 'UUID', obligatorio: false, descripcion: 'Solo una sucursal.' },
      { nombre: 'pagina', en: 'query', tipo: 'entero', obligatorio: false, descripcion: 'Desde 1. Por defecto 1.' },
      { nombre: 'por_pagina', en: 'query', tipo: 'entero', obligatorio: false, descripcion: 'Por defecto 100, máximo 500.' },
    ],
    respuestas: [
      { codigo: 200, descripcion: 'Página de citas. Si total > pagina × por_pagina, pedir la siguiente.', ejemplo: { citas: [CITA_EJEMPLO], pagina: 1, por_pagina: 100, total: 1 } },
      { codigo: 400, descripcion: 'Parámetro inválido o rango mayor a 31 días.', ejemplo: { error: 'Consulta como máximo 31 días' } },
      ERROR_401,
    ],
  },
  {
    id: 'estado',
    grupo: '3. Confirmar / Cancelar',
    metodo: 'POST',
    ruta: '/citas/{id}/estado',
    titulo: 'Confirmar o cancelar una cita',
    descripcion:
      'Informa la respuesta del tutor. Cambios permitidos: RESERVADA → CONFIRMADA y RESERVADA o CONFIRMADA → CANCELADA. Al cancelar, la hora queda libre en la agenda.',
    parametros: [ID_CITA],
    cuerpo: { estado: 'CONFIRMADA', resultado: 'CONFIRMA', canal: 'EMAIL', id_externo: 'evt-6f1c-1' },
    campos: [
      { nombre: 'estado', tipo: 'texto', obligatorio: true, descripcion: 'CONFIRMADA o CANCELADA.' },
      { nombre: 'resultado', tipo: 'texto', obligatorio: false, descripcion: 'CONFIRMA o CANCELA; debe corresponder al estado.' },
      CANAL,
      { nombre: 'motivo', tipo: 'texto (máx. 300)', obligatorio: false, descripcion: 'Solo al cancelar.' },
      ID_EXTERNO,
    ],
    respuestas: [
      { codigo: 200, descripcion: 'Aplicado. Si ya estaba en ese estado: "sin_cambios": true; si el id_externo se repite: "duplicado": true.', ejemplo: { cita: { ...CITA_EJEMPLO, estado: 'CONFIRMADA', confirmada_at: '2026-10-21T15:04:00Z', canal_confirmacion: 'EMAIL' } } },
      { codigo: 409, descripcion: 'Cambio no permitido (ya llegó, fue atendida o cancelada), la hora pasó, se intenta cancelar una cita pagada en línea o cambió durante la operación. No reintentar: volver a consultar.', ejemplo: { error: 'La cita está CANCELADA; no se puede pasar a CONFIRMADA' } },
      ERROR_404,
      ERROR_401,
    ],
  },
  {
    id: 'disponibles',
    grupo: '4. Reagendar',
    metodo: 'GET',
    ruta: '/citas/{id}/disponibles',
    titulo: 'Horas libres para reagendar',
    descripcion:
      'Horas libres en la misma sucursal y para el mismo servicio de la cita, con cualquier profesional que lo atienda. Solo citas RESERVADA o CONFIRMADA, futuras y no pagadas.',
    parametros: [
      ID_CITA,
      { nombre: 'desde', en: 'query', tipo: 'AAAA-MM-DD', obligatorio: false, descripcion: 'Por defecto, hoy.' },
      { nombre: 'hasta', en: 'query', tipo: 'AAAA-MM-DD', obligatorio: false, descripcion: 'Por defecto, desde + 13 días. Máximo 31 días.' },
    ],
    respuestas: [
      {
        codigo: 200,
        descripcion: 'Solo los días con horas libres.',
        ejemplo: {
          cita: CITA_EJEMPLO,
          dias: [
            {
              fecha: '2026-10-23',
              turnos: [{ hora_inicio: '09:00', hora_fin: '09:30', profesional: { id: '…', nombre: 'Ignacio Pérez' } }],
            },
          ],
        },
      },
      { codigo: 409, descripcion: 'La cita no se puede reagendar (estado, pagada o ya pasó).', ejemplo: { error: 'La cita está pagada en línea: el cambio de hora lo gestiona la sucursal' } },
      ERROR_404,
      ERROR_401,
    ],
  },
  {
    id: 'reagendar',
    grupo: '4. Reagendar',
    metodo: 'POST',
    ruta: '/citas/{id}/reagendar',
    titulo: 'Cambiar la cita a otra hora',
    descripcion:
      'En una sola operación cancela la cita original y crea la nueva, ya CONFIRMADA, en la hora elegida (sacada de "Horas libres"). Desde aquí el motor gestiona cita_nueva.id.',
    parametros: [ID_CITA],
    cuerpo: { fecha: '2026-10-23', hora_inicio: '09:00', profesional_id: '…', canal: 'EMAIL', id_externo: 'reag-6f1c-1' },
    campos: [
      { nombre: 'fecha', tipo: 'AAAA-MM-DD', obligatorio: true, descripcion: 'Día de la nueva hora.' },
      { nombre: 'hora_inicio', tipo: 'HH:MM', obligatorio: true, descripcion: 'Inicio de la nueva hora.' },
      { nombre: 'profesional_id', tipo: 'UUID', obligatorio: true, descripcion: 'Profesional del turno elegido.' },
      CANAL,
      ID_EXTERNO,
    ],
    respuestas: [
      {
        codigo: 201,
        descripcion: 'Reagendada. Si ya se había reagendado, responde 200 con la misma cita nueva y "duplicado": true.',
        ejemplo: {
          cita_anterior: { ...CITA_EJEMPLO, estado: 'CANCELADA' },
          cita_nueva: { ...CITA_EJEMPLO, id: '9a2b…', fecha: '2026-10-23', hora_inicio: '09:00', hora_fin: '09:30', estado: 'CONFIRMADA', canal_confirmacion: 'EMAIL' },
        },
      },
      { codigo: 400, descripcion: 'Datos inválidos o el profesional no atiende el servicio.', ejemplo: { error: 'profesional_id: ese profesional no atiende el servicio de la cita' } },
      { codigo: 409, descripcion: 'La hora ya no está libre o la cita no es reagendable. Volver a consultar las horas libres.', ejemplo: { error: 'Esa hora ya no está disponible; consulta de nuevo las horas libres' } },
      ERROR_404,
      ERROR_401,
    ],
  },
  {
    id: 'liberar',
    grupo: '5. Liberar',
    metodo: 'POST',
    ruta: '/citas/{id}/liberar',
    titulo: 'Liberar el cupo a la lista de espera',
    descripcion:
      'Si el tutor no confirma a tiempo (mensaje entregado) o pide otra hora sin elegirla: la cita pasa a CANCELADA, la hora queda libre y el cupo entra a la lista de espera. Solo citas RESERVADA, futuras y no pagadas.',
    parametros: [ID_CITA],
    cuerpo: { resultado: 'SIN_RESPUESTA', canal: 'EMAIL', id_externo: 'lib-6f1c-1' },
    campos: [
      { nombre: 'resultado', tipo: 'texto', obligatorio: false, descripcion: 'SIN_RESPUESTA (defecto) o REAGENDA.' },
      CANAL,
      { nombre: 'motivo', tipo: 'texto (máx. 300)', obligatorio: false, descripcion: 'Por defecto, "Liberada: sin confirmación".' },
      ID_EXTERNO,
    ],
    respuestas: [
      {
        codigo: 200,
        descripcion: 'Liberada. Repetir sobre una cita ya liberada devuelve el mismo cupo con "duplicado": true.',
        ejemplo: {
          cita: { ...CITA_EJEMPLO, estado: 'CANCELADA' },
          cupo: { id: 'b71e…', sucursal_id: '…', profesional_id: '…', servicio_id: '…', especialidad_id: '…', fecha: '2026-10-22', hora_inicio: '10:30', hora_fin: '11:00', liberado_at: '2026-10-21T22:00:03Z' },
        },
      },
      { codigo: 409, descripcion: 'La cita no está RESERVADA, está pagada en línea o ya pasó.', ejemplo: { error: 'La cita está CONFIRMADA; solo se liberan citas RESERVADA' } },
      ERROR_404,
      ERROR_401,
    ],
  },
  {
    id: 'estados',
    grupo: 'Referencia',
    metodo: 'GET',
    ruta: '/estados',
    titulo: 'Matriz de estados',
    descripcion: 'Estados de la cita en el Core y qué llamada hacer según el resultado del contacto.',
    respuestas: [
      {
        codigo: 200,
        descripcion: 'Matriz completa.',
        ejemplo: {
          estados_core: [{ estado: 'RESERVADA', descripcion: 'Agendada, pendiente de confirmar', gestionable: true }],
          matriz: [{ resultado: 'CONFIRMA', descripcion: 'El tutor confirma la hora', accion: 'ESTADO', estado_core: 'CONFIRMADA' }],
        },
      },
      ERROR_401,
    ],
  },
]
