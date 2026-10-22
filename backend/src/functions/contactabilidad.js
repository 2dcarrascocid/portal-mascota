// API /api/v1 para el sistema externo de contactabilidad: nómina de citas a
// gestionar, confirmación/cancelación y liberación de cupos a la lista de
// espera. Autenticación inter-sistema OAuth2 client credentials
// (lib/integracion.js); todo queda aislado a la organización de la credencial.
// Además, la administración de credenciales (ORG_ADMIN, API del portal).
const { supabase, errorDb } = require('../lib/supabase');
const { requerirAdminOrg } = require('../lib/acceso');
const d = require('../lib/disponibilidad');
const v = require('../lib/validar');
const ig = require('../lib/integracion');
const { sha256 } = require('../lib/sesiones');
const { HttpError, json, parseJson, parseForm, header, handler } = require('../lib/http');
const { liberarReservasVencidas, profesionalesSegun, turnosLibres, MAX_DIAS_BUSQUEDA } = require('./citas');

const ESTADOS_NOMINA = ['RESERVADA', 'CONFIRMADA'];
const CANALES = ['WHATSAPP', 'SMS', 'EMAIL', 'VOZ', 'LLAMADA'];
const MAX_POR_PAGINA = 500;
// Desde qué estados se puede llegar a cada uno (el mismo estado = sin cambio).
const ORIGENES = { CONFIRMADA: ['RESERVADA'], CANCELADA: ['RESERVADA', 'CONFIRMADA'] };

const COLUMNAS =
  'id, date, start_time, end_time, status, payment_status, confirmed_at, confirmation_channel, ' +
  'contact_name, contact_phone, contact_email, ' +
  'branch:branches(id, name, address, phone), ' +
  'staff:usuarios!appointments_staff_id_fkey(id, first_name, last_name, full_name), ' +
  'service:services_catalog(id, name), specialty:specialties(id, name), ' +
  'client:clients(id, national_id), pet:pets!appointments_pet_id_fkey(id, name)';

// '12345678-9' -> '12.***.***-9': el motor nunca recibe el RUT completo.
function rutEnmascarado(rut) {
  if (!rut) return null;
  const [cuerpo, dv] = rut.split('-');
  return `${cuerpo.slice(0, -6)}.***.***-${dv}`;
}

// Teléfono chileno a E.164 si se puede inferir; si no, null (va el original).
function telefonoE164(telefono) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (/^569\d{8}$/.test(digitos) || /^56[2-8]\d{8}$/.test(digitos)) return `+${digitos}`;
  if (/^9\d{8}$/.test(digitos)) return `+56${digitos}`;
  return null;
}

const hhmm = (hora) => hora?.slice(0, 5) ?? null;

function aDto(c) {
  const staff = c.staff;
  return {
    id: c.id,
    fecha: c.date,
    hora_inicio: hhmm(c.start_time),
    hora_fin: hhmm(c.end_time),
    estado: c.status,
    pago: c.payment_status,
    confirmada_at: c.confirmed_at,
    canal_confirmacion: c.confirmation_channel,
    sucursal: c.branch && { id: c.branch.id, nombre: c.branch.name, direccion: c.branch.address, telefono: c.branch.phone },
    profesional: staff && {
      id: staff.id,
      nombre: [staff.first_name, staff.last_name].filter(Boolean).join(' ') || staff.full_name,
    },
    servicio: c.service && { id: c.service.id, nombre: c.service.name },
    especialidad: c.specialty && { id: c.specialty.id, nombre: c.specialty.name },
    mascota: c.pet && { id: c.pet.id, nombre: c.pet.name },
    tutor: {
      nombre: c.contact_name,
      telefono: c.contact_phone,
      telefono_e164: telefonoE164(c.contact_phone),
      email: c.contact_email,
      rut_enmascarado: rutEnmascarado(c.client?.national_id),
    },
  };
}

async function obtenerCita(id, orgId) {
  const { data, error } = await supabase()
    .from('appointments')
    .select(COLUMNAS)
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw errorDb(error);
  if (!data) throw new HttpError(404, 'Cita no encontrada');
  return data;
}

const yaPaso = (cita, ahora) => cita.date < ahora.fecha || (cita.date === ahora.fecha && cita.start_time.slice(0, 5) <= d.aHora(ahora.minuto));

// Evento ya procesado (reintento del motor con el mismo id_externo).
async function eventoPrevio(credencial, externalId) {
  if (!externalId) return null;
  const { data, error } = await supabase()
    .from('contact_events')
    .select('appointment_id, action')
    .eq('integration_client_id', credencial.id)
    .eq('external_id', externalId)
    .maybeSingle();
  if (error) throw errorDb(error);
  return data;
}

async function registrarEvento(evento) {
  const { error } = await supabase().from('contact_events').insert(evento);
  // 23505: el mismo id_externo llegó dos veces en paralelo; el primero ganó.
  if (error && error.code !== '23505') throw errorDb(error);
}

function datosEvento(body) {
  return {
    canal: body.canal == null || body.canal === '' ? null : v.opcion(body.canal, 'canal', CANALES),
    externalId: v.texto(body.id_externo, 'id_externo', { max: 120 }),
  };
}

// ── OAuth2 ───────────────────────────────────────────────────

const errorOAuth = (statusCode, error, descripcion) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ error, error_description: descripcion }),
});

// POST /api/v1/oauth/token  (application/x-www-form-urlencoded o JSON)
//   grant_type=client_credentials, credenciales por HTTP Basic o en el cuerpo.
module.exports.token = handler(async (event) => {
  const tipo = header(event, 'content-type') || '';
  const body = tipo.includes('application/json') ? parseJson(event) : parseForm(event);
  if (body.grant_type !== 'client_credentials') {
    return errorOAuth(400, 'unsupported_grant_type', 'Solo se admite grant_type=client_credentials');
  }

  let clientId = body.client_id;
  let clientSecret = body.client_secret;
  const [esquema, basic] = (header(event, 'authorization') || '').split(' ');
  if (esquema === 'Basic' && basic) {
    const decodificado = Buffer.from(basic, 'base64').toString('utf8');
    const separador = decodificado.indexOf(':');
    clientId = decodeURIComponent(decodificado.slice(0, separador));
    clientSecret = decodeURIComponent(decodificado.slice(separador + 1));
  }

  const credencial = await ig.validarCredenciales(clientId, clientSecret);
  if (!credencial) return errorOAuth(401, 'invalid_client', 'Credenciales inválidas o revocadas');
  const token = await ig.emitirToken(credencial);
  return { ...json(200, token), headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } };
});

// ── API del motor ────────────────────────────────────────────

// GET /api/v1/estados  -> matriz de mapeo de estados (referencia).
module.exports.matrizEstados = handler(async (event) => {
  await ig.requerirIntegracion(event);
  return json(200, { estados_core: ig.ESTADOS_CORE, matriz: ig.MATRIZ_ESTADOS });
});

// GET /api/v1/citas/programadas?desde=&hasta=&sucursal=&estado=&pagina=&por_pagina=
// Citas futuras a gestionar (por defecto RESERVADA, de hoy a 7 días). No
// incluye reservas del portal con el pago en línea en curso.
module.exports.programadas = handler(async (event) => {
  const credencial = await ig.requerirIntegracion(event);
  const q = event.queryStringParameters || {};
  const ahora = d.ahoraLocal();
  const desde = v.fecha(q.desde, 'desde') || ahora.fecha;
  const hasta = v.fecha(q.hasta, 'hasta') || d.sumarDias(desde, 7);
  if (hasta < desde) throw new HttpError(400, 'El rango de fechas está invertido');
  if (d.diasEntre(desde, hasta) >= MAX_DIAS_BUSQUEDA) throw new HttpError(400, `Consulta como máximo ${MAX_DIAS_BUSQUEDA} días`);
  const estados = q.estado ? String(q.estado).split(',').map((e) => v.opcion(e.trim(), 'estado', ESTADOS_NOMINA)) : ['RESERVADA'];
  const pagina = v.entero(q.pagina ?? 1, 'pagina', { min: 1 });
  const porPagina = v.entero(q.por_pagina ?? 100, 'por_pagina', { min: 1, max: MAX_POR_PAGINA });

  await liberarReservasVencidas();
  const inicio = desde < ahora.fecha ? ahora.fecha : desde;
  if (hasta < inicio) return json(200, { citas: [], pagina, por_pagina: porPagina, total: 0 });

  let consulta = supabase()
    .from('appointments')
    .select(COLUMNAS, { count: 'exact' })
    .eq('organization_id', credencial.organization_id)
    .gte('date', inicio)
    .lte('date', hasta)
    .in('status', estados)
    .or('payment_status.is.null,payment_status.eq.PAGADO')
    .order('date')
    .order('start_time')
    .order('id')
    .range((pagina - 1) * porPagina, pagina * porPagina - 1);
  // Hoy, solo las que aún no empiezan.
  if (inicio === ahora.fecha) consulta = consulta.or(`date.gt.${inicio},start_time.gt.${d.aHora(ahora.minuto)}`);
  if (q.sucursal) consulta = consulta.eq('branch_id', v.uuid(q.sucursal, 'sucursal'));

  const { data, count, error } = await consulta;
  if (error) throw errorDb(error);
  return json(200, { citas: data.map(aDto), pagina, por_pagina: porPagina, total: count });
});

// POST /api/v1/citas/{id}/estado  { estado: CONFIRMADA|CANCELADA, resultado?, canal?, motivo?, id_externo? }
// Idempotente: repetir el mismo estado o el mismo id_externo no cambia nada.
module.exports.actualizarEstado = handler(async (event) => {
  const credencial = await ig.requerirIntegracion(event);
  const org = credencial.organization_id;
  const id = v.uuid(event.pathParameters.id, 'id');
  const body = parseJson(event);
  const estado = v.opcion(body.estado, 'estado', Object.keys(ORIGENES));
  const resultado = ig.resultadoPara(body.resultado, 'ESTADO', estado);
  const { canal, externalId } = datosEvento(body);
  const motivo = v.texto(body.motivo, 'motivo', { max: 300 });

  if (await eventoPrevio(credencial, externalId)) return json(200, { cita: aDto(await obtenerCita(id, org)), duplicado: true });

  const cita = await obtenerCita(id, org);
  if (cita.status === estado) return json(200, { cita: aDto(cita), sin_cambios: true });
  if (!ORIGENES[estado].includes(cita.status)) {
    throw new HttpError(409, `La cita está ${cita.status}; no se puede pasar a ${estado}`);
  }
  if (yaPaso(cita, d.ahoraLocal())) throw new HttpError(409, 'La hora de la cita ya pasó');
  if (estado === 'CANCELADA' && cita.payment_status === 'PAGADO') {
    throw new HttpError(409, 'La cita está pagada en línea: la cancelación (y devolución) la gestiona la sucursal');
  }

  const cambios =
    estado === 'CONFIRMADA'
      ? { status: estado, confirmed_at: new Date().toISOString(), confirmation_channel: canal }
      : { status: estado, cancel_reason: motivo || 'Cancelada por el tutor (contactabilidad)' };
  // La condición sobre el estado leído evita pisar un cambio concurrente
  // (p. ej. la recepción marcó la llegada entre la lectura y el update).
  const { data, error } = await supabase()
    .from('appointments')
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', cita.status)
    .select('id');
  if (error) throw errorDb(error);
  if (!data.length) throw new HttpError(409, 'La cita cambió de estado mientras se procesaba; vuelve a consultarla');

  await registrarEvento({
    organization_id: org,
    appointment_id: id,
    integration_client_id: credencial.id,
    action: 'ESTADO',
    engine_result: resultado,
    channel: canal,
    external_id: externalId,
    previous_status: cita.status,
    new_status: estado,
  });
  return json(200, { cita: aDto(await obtenerCita(id, org)) });
});

async function cupoDe(appointmentId) {
  const { data, error } = await supabase()
    .from('waitlist_slots')
    .select('id, branch_id, staff_id, date, start_time, end_time, service_id, specialty_id, released_at')
    .eq('released_appointment_id', appointmentId)
    .maybeSingle();
  if (error) throw errorDb(error);
  return (
    data && {
      id: data.id,
      sucursal_id: data.branch_id,
      profesional_id: data.staff_id,
      servicio_id: data.service_id,
      especialidad_id: data.specialty_id,
      fecha: data.date,
      hora_inicio: hhmm(data.start_time),
      hora_fin: hhmm(data.end_time),
      liberado_at: data.released_at,
    }
  );
}

// POST /api/v1/citas/{id}/liberar  { resultado?: SIN_RESPUESTA|REAGENDA, canal?, motivo?, id_externo? }
// Cancela la cita (el turno queda libre en la agenda) e ingresa el cupo a la
// lista de espera. Solo citas RESERVADA, futuras y no pagadas en línea.
module.exports.liberar = handler(async (event) => {
  const credencial = await ig.requerirIntegracion(event);
  const org = credencial.organization_id;
  const id = v.uuid(event.pathParameters.id, 'id');
  const body = parseJson(event);
  const resultado = ig.resultadoPara(body.resultado, 'LIBERAR');
  const { canal, externalId } = datosEvento(body);
  const motivo =
    v.texto(body.motivo, 'motivo', { max: 300 }) ||
    (resultado === 'REAGENDA' ? 'Liberada: el tutor pidió reagendar' : 'Liberada: sin confirmación');

  const previo = await eventoPrevio(credencial, externalId);
  const cita = await obtenerCita(id, org);
  if (previo || cita.status === 'CANCELADA') {
    const cupo = await cupoDe(id);
    if (cupo) return json(200, { cita: aDto(cita), cupo, duplicado: true });
  }
  if (cita.status !== 'RESERVADA') throw new HttpError(409, `La cita está ${cita.status}; solo se liberan citas RESERVADA`);
  if (cita.payment_status === 'PAGADO') throw new HttpError(409, 'La cita está pagada en línea: no se libera automáticamente');
  const ahora = d.ahoraLocal();
  if (yaPaso(cita, ahora)) throw new HttpError(409, 'La hora de la cita ya pasó');

  const { data: cupoId, error } = await supabase().rpc('release_appointment_to_waitlist', {
    p_appointment_id: id,
    p_organization_id: org,
    p_reason: motivo,
    p_today: ahora.fecha,
    p_now_time: d.aHora(ahora.minuto),
  });
  if (error) throw errorDb(error);
  if (!cupoId) throw new HttpError(409, 'La cita cambió de estado mientras se procesaba; vuelve a consultarla');

  await registrarEvento({
    organization_id: org,
    appointment_id: id,
    integration_client_id: credencial.id,
    action: 'LIBERAR',
    engine_result: resultado,
    channel: canal,
    external_id: externalId,
    previous_status: 'RESERVADA',
    new_status: 'CANCELADA',
  });
  return json(200, { cita: aDto(await obtenerCita(id, org)), cupo: await cupoDe(id) });
});

// ── Reagendar ────────────────────────────────────────────────

const ESTADOS_REAGENDABLES = ['RESERVADA', 'CONFIRMADA'];
const DIAS_REAGENDA = 14;

// Profesionales que pueden atender la cita: los que dan su servicio (o su
// especialidad); sin ninguno de los dos, solo el mismo profesional.
async function profesionalesPara(cita, orgId) {
  if (cita.service) return profesionalesSegun(orgId, { serviceId: cita.service.id });
  if (cita.specialty) return profesionalesSegun(orgId, { specialtyId: cita.specialty.id });
  return cita.staff ? [cita.staff.id] : [];
}

async function nombresPersonal(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase().from('usuarios').select('id, first_name, last_name, full_name').in('id', ids);
  if (error) throw errorDb(error);
  return new Map(data.map((u) => [u.id, [u.first_name, u.last_name].filter(Boolean).join(' ') || u.full_name]));
}

function exigirReagendable(cita, ahora) {
  if (!ESTADOS_REAGENDABLES.includes(cita.status)) {
    throw new HttpError(409, `La cita está ${cita.status}; solo se reagendan citas RESERVADA o CONFIRMADA`);
  }
  if (cita.payment_status === 'PAGADO') throw new HttpError(409, 'La cita está pagada en línea: el cambio de hora lo gestiona la sucursal');
  if (yaPaso(cita, ahora)) throw new HttpError(409, 'La hora de la cita ya pasó');
}

// GET /api/v1/citas/{id}/disponibles?desde=&hasta=
// Horas libres para reagendar: misma sucursal, mismo servicio (cualquier
// profesional que lo atienda). Por defecto, de hoy a 14 días.
module.exports.disponiblesReagenda = handler(async (event) => {
  const credencial = await ig.requerirIntegracion(event);
  const org = credencial.organization_id;
  const cita = await obtenerCita(v.uuid(event.pathParameters.id, 'id'), org);
  const ahora = d.ahoraLocal();
  exigirReagendable(cita, ahora);

  const q = event.queryStringParameters || {};
  const desde = v.fecha(q.desde, 'desde') || ahora.fecha;
  const hasta = v.fecha(q.hasta, 'hasta') || d.sumarDias(desde, DIAS_REAGENDA - 1);
  if (hasta < desde) throw new HttpError(400, 'El rango de fechas está invertido');
  if (d.diasEntre(desde, hasta) >= MAX_DIAS_BUSQUEDA) throw new HttpError(400, `Consulta como máximo ${MAX_DIAS_BUSQUEDA} días`);

  const staffIds = await profesionalesPara(cita, org);
  const dias = await turnosLibres(org, { desde, hasta, staffIds, branchId: cita.branch.id });
  const nombres = await nombresPersonal(staffIds);
  const resultado = dias
    .map((dia) => ({
      fecha: dia.fecha,
      turnos: dia.agendas
        .filter((a) => a.branch_id === cita.branch.id)
        .flatMap((a) =>
          a.turnos.map((t) => ({
            hora_inicio: t.inicio,
            hora_fin: t.fin,
            profesional: { id: a.staff_id, nombre: nombres.get(a.staff_id) ?? null },
          }))
        )
        .sort((x, y) => x.hora_inicio.localeCompare(y.hora_inicio)),
    }))
    .filter((dia) => dia.turnos.length);
  return json(200, { cita: aDto(cita), dias: resultado });
});

async function reagendadaDesde(id, org) {
  const { data, error } = await supabase()
    .from('appointments')
    .select('id')
    .eq('rescheduled_from', id)
    .eq('organization_id', org)
    .maybeSingle();
  if (error) throw errorDb(error);
  return data && (await obtenerCita(data.id, org));
}

// POST /api/v1/citas/{id}/reagendar  { fecha, hora_inicio, profesional_id, canal?, id_externo? }
// Toma la hora nueva (nace CONFIRMADA) y cancela la original, en una sola
// transacción. Idempotente: repetir sobre una cita ya reagendada devuelve
// la misma cita nueva.
module.exports.reagendar = handler(async (event) => {
  const credencial = await ig.requerirIntegracion(event);
  const org = credencial.organization_id;
  const id = v.uuid(event.pathParameters.id, 'id');
  const body = parseJson(event);
  const fecha = v.fecha(body.fecha, 'fecha');
  if (!fecha) throw new HttpError(400, 'fecha: es obligatoria');
  const hora = v.hora(body.hora_inicio, 'hora_inicio');
  const staffId = v.uuid(body.profesional_id, 'profesional_id');
  const { canal, externalId } = datosEvento(body);

  const previo = await eventoPrevio(credencial, externalId);
  const cita = await obtenerCita(id, org);
  if (previo || cita.status === 'CANCELADA') {
    const nueva = await reagendadaDesde(id, org);
    if (nueva) return json(200, { cita_anterior: aDto(cita), cita_nueva: aDto(nueva), duplicado: true });
  }
  const ahora = d.ahoraLocal();
  exigirReagendable(cita, ahora);

  if (!(await profesionalesPara(cita, org)).includes(staffId)) {
    throw new HttpError(400, 'profesional_id: ese profesional no atiende el servicio de la cita');
  }
  // La hora debe existir en la programación de esa sucursal y estar libre.
  const dias = await turnosLibres(org, { desde: fecha, hasta: fecha, staffIds: [staffId], branchId: cita.branch.id });
  const turno = dias[0]?.agendas
    .find((a) => a.staff_id === staffId && a.branch_id === cita.branch.id)
    ?.turnos.find((t) => t.inicio === hora);
  if (!turno) throw new HttpError(409, 'Esa hora ya no está disponible; consulta de nuevo las horas libres');

  const { data: nuevaId, error } = await supabase().rpc('reschedule_appointment', {
    p_appointment_id: id,
    p_organization_id: org,
    p_staff_id: staffId,
    p_date: fecha,
    p_start_time: turno.inicio,
    p_end_time: turno.fin,
    p_channel: canal,
    p_today: ahora.fecha,
    p_now_time: d.aHora(ahora.minuto),
  });
  if (error?.code === '23505') throw new HttpError(409, 'Esa hora acaba de ser tomada; consulta de nuevo las horas libres');
  if (error) throw errorDb(error);
  if (!nuevaId) throw new HttpError(409, 'La cita cambió de estado mientras se procesaba; vuelve a consultarla');

  await registrarEvento({
    organization_id: org,
    appointment_id: id,
    integration_client_id: credencial.id,
    action: 'REAGENDAR',
    engine_result: 'REAGENDA',
    channel: canal,
    external_id: externalId,
    previous_status: cita.status,
    new_status: 'CANCELADA',
  });
  return json(201, { cita_anterior: aDto(await obtenerCita(id, org)), cita_nueva: aDto(await obtenerCita(nuevaId, org)) });
});

// ── Administración de credenciales (portal, ORG_ADMIN) ───────

const COLUMNAS_CREDENCIAL = 'id, name, client_id, created_at, last_used_at, revoked_at';

// GET /integraciones/credenciales
module.exports.listarCredenciales = handler(async (event) => {
  const usuario = await requerirAdminOrg(event);
  const { data, error } = await supabase()
    .from('integration_clients')
    .select(COLUMNAS_CREDENCIAL)
    .eq('organization_id', usuario.organization_id)
    .order('created_at', { ascending: false });
  if (error) throw errorDb(error);
  return json(200, { credenciales: data });
});

// POST /integraciones/credenciales  { name }
// El client_secret se devuelve solo en esta respuesta; en la base queda su hash.
module.exports.crearCredencial = handler(async (event) => {
  const usuario = await requerirAdminOrg(event);
  const body = parseJson(event);
  const secreto = ig.nuevoSecreto();
  const { data, error } = await supabase()
    .from('integration_clients')
    .insert({
      organization_id: usuario.organization_id,
      name: v.texto(body.name, 'Nombre', { requerido: true, max: 120 }),
      client_id: ig.nuevoClientId(),
      client_secret_hash: sha256(secreto),
      created_by: usuario.id,
    })
    .select(COLUMNAS_CREDENCIAL)
    .single();
  if (error) throw errorDb(error);
  return json(201, { credencial: { ...data, client_secret: secreto } });
});

// DELETE /integraciones/credenciales/{id}  -> revoca (corta el acceso al instante).
module.exports.revocarCredencial = handler(async (event) => {
  const usuario = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  const { data, error } = await supabase()
    .from('integration_clients')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', usuario.organization_id)
    .is('revoked_at', null)
    .select('id');
  if (error) throw errorDb(error);
  if (!data.length) throw new HttpError(404, 'Credencial no encontrada o ya revocada');
  return json(200, { ok: true });
});
