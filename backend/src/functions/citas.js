// Módulo Agenda: búsqueda de turnos disponibles y reserva de citas.
// Los turnos salen de la programación de agenda (lib/disponibilidad.js)
// menos las citas vigentes. Una cita ocupa un turno.
const { supabase, errorDb } = require('../lib/supabase');
const { ROLES_PERSONAL, requerirPermiso, sucursalesDe, requerirSucursal, deLaOrganizacion } = require('../lib/acceso');
const d = require('../lib/disponibilidad');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');
const { cargarBloques, cargarExcepciones } = require('./agendas');

const ESTADOS = ['RESERVADA', 'CONFIRMADA', 'LLEGO', 'ATENDIDA', 'NO_ASISTIO', 'CANCELADA'];
// LLEGO lo pone y lo quita el módulo Recepción (functions/recepcion.js).
const ESTADOS_MANUALES = ESTADOS.filter((e) => e !== 'LLEGO');
const CARGOS = ['VET', 'GROOMER', 'TRAINER', 'ORG_ADMIN', 'STAFF'];
// Sin especialidades asignadas, el servicio se ofrece por el cargo de su tipo
// (el personal STAFF, sin cargo, también puede ofrecerlo).
const CARGO_DE_CATEGORIA = { VET: 'VET', GROOMING: 'GROOMER', TRAINING: 'TRAINER' };
const MAX_DIAS_BUSQUEDA = 31;

const COLUMNAS =
  'id, branch_id, staff_id, date, start_time, end_time, service_id, specialty_id, client_id, pet_id, ' +
  'contact_name, contact_phone, contact_email, notes, status, cancel_reason, created_at, payment_status, payment_amount, ' +
  'client:clients(id, first_name, last_name, national_id, phone, email), pet:pets(id, name, species_id)';

// Cancela las reservas del portal cuyo pago en línea venció (libera el turno).
async function liberarReservasVencidas() {
  const { error } = await supabase().rpc('release_expired_bookings');
  if (error) throw errorDb(error);
}

// Citas que ocupan turno (todas menos las canceladas).
async function citasVigentes(orgId, desde, hasta, staffIds) {
  await liberarReservasVencidas();
  let consulta = supabase()
    .from('appointments')
    .select('staff_id, date, start_time, end_time')
    .eq('organization_id', orgId)
    .gte('date', desde)
    .lte('date', hasta)
    .neq('status', 'CANCELADA');
  if (staffIds) consulta = consulta.in('staff_id', staffIds);
  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  return data;
}

// Profesionales que cumplen los filtros: { ids, porId } (null = sin filtro).
async function profesionalesSegun(orgId, { staffId, cargo, specialtyId, serviceId }) {
  const { data: personal, error } = await supabase()
    .from('usuarios')
    .select('id, role, staff_specialties(specialty_id)')
    .eq('organization_id', orgId)
    .eq('activo', true)
    .in('role', ROLES_PERSONAL);
  if (error) throw errorDb(error);

  let especialidadesServicio = null;
  let cargoServicio = null;
  if (serviceId) {
    const { data: servicio, error: errorServicio } = await supabase()
      .from('services_catalog')
      .select('category, specialty_services(specialty_id)')
      .eq('id', serviceId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (errorServicio) throw errorDb(errorServicio);
    if (!servicio) throw new HttpError(404, 'Servicio no encontrado');
    especialidadesServicio = servicio.specialty_services.map((s) => s.specialty_id);
    if (!especialidadesServicio.length) cargoServicio = CARGO_DE_CATEGORIA[servicio.category];
  }

  return personal
    .filter((p) => {
      const especialidades = p.staff_specialties.map((s) => s.specialty_id);
      if (staffId && p.id !== staffId) return false;
      if (cargo && p.role !== cargo) return false;
      if (specialtyId && !especialidades.includes(specialtyId)) return false;
      if (especialidadesServicio?.length && !especialidades.some((e) => especialidadesServicio.includes(e))) return false;
      if (cargoServicio && p.role !== cargoServicio && p.role !== 'STAFF') return false;
      return true;
    })
    .map((p) => p.id);
}

// Turnos libres por día para esos profesionales, sin horas ya pasadas.
// permitidas: ids de las sucursales a mostrar (null = todas).
async function turnosLibres(orgId, { desde, hasta, staffIds, branchId, permitidas = null }) {
  const ahora = d.ahoraLocal();
  const inicio = desde < ahora.fecha ? ahora.fecha : desde;
  if (hasta < inicio || !staffIds.length) return [];

  const [bloques, excepciones, ocupados] = await Promise.all([
    cargarBloques(orgId, { branchId }),
    cargarExcepciones(orgId, inicio, hasta, { branchId }),
    citasVigentes(orgId, inicio, hasta, staffIds),
  ]);
  const dias = d.disponibilidad({
    bloques: bloques.filter((b) => staffIds.includes(b.staff_id)),
    excepciones,
    desde: inicio,
    hasta,
    ocupados,
    desdeMinuto: inicio === ahora.fecha ? ahora.minuto : 0,
  });
  return dias.map((dia) => ({
    ...dia,
    agendas: dia.agendas
      .filter((a) => a.turnos.length && (!permitidas || permitidas.includes(a.branch_id)))
      .map(({ bloqueos, ...a }) => a),
  }));
}

// GET /citas/disponibles?desde=&hasta=&branchId=&staffId=&cargo=&specialtyId=&serviceId=
module.exports.disponibles = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'citas.ver');
  const q = event.queryStringParameters || {};
  const desde = v.fecha(q.desde, 'desde') || d.ahoraLocal().fecha;
  const hasta = v.fecha(q.hasta, 'hasta') || d.sumarDias(desde, 6);
  if (hasta < desde) throw new HttpError(400, 'El rango de fechas está invertido');
  if (d.diasEntre(desde, hasta) >= MAX_DIAS_BUSQUEDA) throw new HttpError(400, `Busca como máximo ${MAX_DIAS_BUSQUEDA} días`);

  const staffIds = await profesionalesSegun(usuario.organization_id, {
    staffId: q.staffId && v.uuid(q.staffId, 'staffId'),
    cargo: q.cargo && v.opcion(q.cargo, 'Cargo', CARGOS),
    specialtyId: q.specialtyId && v.uuid(q.specialtyId, 'specialtyId'),
    serviceId: q.serviceId && v.uuid(q.serviceId, 'serviceId'),
  });
  const dias = await turnosLibres(usuario.organization_id, {
    desde,
    hasta,
    staffIds,
    branchId: q.branchId && v.uuid(q.branchId, 'branchId'),
    permitidas: await sucursalesDe(usuario),
  });
  return json(200, { dias });
});

// ── Citas ────────────────────────────────────────────────────

// Con ficha: tutor (y mascota suya) de la organización; se guarda una copia
// del nombre/teléfono para que la cita no quede sin contacto si se borra el
// tutor. Sin ficha: nombre de contacto obligatorio.
async function datosPaciente(body, orgId) {
  const clientId = v.uuid(body.client_id, 'Tutor', { requerido: false });
  const petId = v.uuid(body.pet_id, 'Mascota', { requerido: false });
  const contacto = {
    contact_name: v.texto(body.contact_name, 'Nombre de contacto', { max: 120 }),
    contact_phone: v.texto(body.contact_phone, 'Teléfono de contacto', { max: 40 }),
    contact_email: v.email(body.contact_email, 'Email de contacto'),
  };
  if (!clientId) {
    if (petId) throw new HttpError(400, 'Para indicar la mascota, elige primero el tutor');
    if (!contacto.contact_name) throw new HttpError(400, 'Sin ficha, indica al menos el nombre de contacto');
    return { client_id: null, pet_id: null, ...contacto };
  }

  const tutor = await deLaOrganizacion('clients', clientId, { organization_id: orgId }, 'id, first_name, last_name, phone, email');
  if (petId) {
    const { data: mascota, error } = await supabase().from('pets').select('id').eq('id', petId).eq('client_id', clientId).maybeSingle();
    if (error) throw errorDb(error);
    if (!mascota) throw new HttpError(400, 'La mascota no pertenece a ese tutor');
  }
  return {
    client_id: clientId,
    pet_id: petId,
    contact_name: contacto.contact_name || `${tutor.first_name} ${tutor.last_name}`,
    contact_phone: contacto.contact_phone || tutor.phone,
    contact_email: contacto.contact_email || tutor.email,
  };
}

async function datosServicio(body, orgId) {
  const serviceId = v.uuid(body.service_id, 'Servicio', { requerido: false });
  const specialtyId = v.uuid(body.specialty_id, 'Especialidad', { requerido: false });
  if (serviceId) await deLaOrganizacion('services_catalog', serviceId, { organization_id: orgId });
  if (specialtyId) await deLaOrganizacion('specialties', specialtyId, { organization_id: orgId });
  return { service_id: serviceId, specialty_id: specialtyId };
}

async function obtener(id) {
  const { data, error } = await supabase().from('appointments').select(COLUMNAS).eq('id', id).single();
  if (error) throw errorDb(error);
  return data;
}

function errorCita(error) {
  if (error.code === '23505') return new HttpError(409, 'Ese turno acaba de ser reservado por otra persona. Elige otro.');
  return errorDb(error);
}

// GET /citas?desde=&hasta=&branchId=&staffId=&clientId=&petId=&estado=&q=
module.exports.listar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'citas.ver');
  const q = event.queryStringParameters || {};
  const desde = v.fecha(q.desde, 'desde');
  const hasta = v.fecha(q.hasta, 'hasta');
  let consulta = supabase()
    .from('appointments')
    .select(COLUMNAS)
    .eq('organization_id', usuario.organization_id)
    .order('date')
    .order('start_time')
    .limit(500);
  if (desde) consulta = consulta.gte('date', desde);
  if (hasta) consulta = consulta.lte('date', hasta);
  if (q.branchId) consulta = consulta.eq('branch_id', v.uuid(q.branchId, 'branchId'));
  if (q.staffId) consulta = consulta.eq('staff_id', v.uuid(q.staffId, 'staffId'));
  if (q.clientId) consulta = consulta.eq('client_id', v.uuid(q.clientId, 'clientId'));
  if (q.petId) consulta = consulta.eq('pet_id', v.uuid(q.petId, 'petId'));
  if (q.estado) consulta = consulta.eq('status', v.opcion(q.estado, 'Estado', ESTADOS));
  const permitidas = await sucursalesDe(usuario);
  if (permitidas) consulta = consulta.in('branch_id', permitidas);

  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  const texto = String(q.q || '').trim().toLowerCase();
  const citas = texto
    ? data.filter((c) =>
        [c.contact_name, c.contact_phone, c.client?.national_id, c.pet?.name].some((x) => x?.toLowerCase().includes(texto))
      )
    : data;
  return json(200, { citas });
});

// POST /citas  { staff_id, branch_id, date, start_time, service_id?, specialty_id?,
//                client_id?, pet_id?, contact_name?, contact_phone?, contact_email?, notes? }
// Reserva un turno libre. Con ficha (client_id) o sin ficha (contact_name).
module.exports.crear = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'citas.crear');
  const body = parseJson(event);
  const staffId = v.uuid(body.staff_id, 'Profesional');
  const branchId = v.uuid(body.branch_id, 'Sucursal');
  const fecha = v.fecha(body.date, 'Fecha');
  if (!fecha) throw new HttpError(400, 'Fecha: es obligatoria');
  const inicio = v.hora(body.start_time, 'Hora');
  if (fecha < d.ahoraLocal().fecha) throw new HttpError(400, 'No se puede reservar en una fecha pasada');
  await requerirSucursal(usuario, branchId);
  const org = usuario.organization_id;

  const [paciente, servicio] = await Promise.all([datosPaciente(body, org), datosServicio(body, org)]);

  // El turno debe existir en la programación y estar libre ahora mismo.
  const dias = await turnosLibres(org, { desde: fecha, hasta: fecha, staffIds: [staffId], branchId });
  const turno = dias[0]?.agendas
    .find((a) => a.staff_id === staffId && a.branch_id === branchId)
    ?.turnos.find((t) => t.inicio === inicio);
  if (!turno) throw new HttpError(409, 'Ese turno ya no está disponible. Actualiza la búsqueda.');

  const { data, error } = await supabase()
    .from('appointments')
    .insert({
      organization_id: org,
      branch_id: branchId,
      staff_id: staffId,
      date: fecha,
      start_time: turno.inicio,
      end_time: turno.fin,
      ...servicio,
      ...paciente,
      notes: v.texto(body.notes, 'Notas', { max: 1000 }),
      created_by: usuario.id,
    })
    .select('id')
    .single();
  if (error) throw errorCita(error);
  return json(201, { cita: await obtener(data.id) });
});

async function citaPermitida(usuario, id) {
  const cita = await deLaOrganizacion('appointments', id, usuario, 'id, branch_id, status');
  await requerirSucursal(usuario, cita.branch_id);
  return cita;
}

// PUT /citas/{id}  -> datos del paciente (p. ej. vincular la ficha), servicio y notas.
// El horario no se cambia: para reagendar se cancela y se reserva otro turno.
module.exports.actualizar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'citas.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  await citaPermitida(usuario, id);
  const body = parseJson(event);
  const org = usuario.organization_id;
  const [paciente, servicio] = await Promise.all([datosPaciente(body, org), datosServicio(body, org)]);

  const { error } = await supabase()
    .from('appointments')
    .update({ ...paciente, ...servicio, notes: v.texto(body.notes, 'Notas', { max: 1000 }), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw errorCita(error);
  return json(200, { cita: await obtener(id) });
});

// PUT /citas/{id}/estado  { status, reason? }
module.exports.cambiarEstado = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'citas.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const cita = await citaPermitida(usuario, id);
  const body = parseJson(event);
  const status = v.opcion(body.status, 'Estado', ESTADOS_MANUALES);
  if (cita.status === 'LLEGO') throw new HttpError(409, 'La mascota está en recepción: cierra o anula la atención desde Recepción');

  const { error } = await supabase()
    .from('appointments')
    .update({
      status,
      cancel_reason: status === 'CANCELADA' ? v.texto(body.reason, 'Motivo', { max: 300 }) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  // Reactivar una cancelada cuyo turno ya se volvió a tomar choca con el índice único.
  if (error) throw errorCita(error);
  return json(200, { cita: await obtener(id) });
});

// DELETE /citas/{id}  (borrar una cita ingresada por error; lo normal es cancelarla)
module.exports.eliminar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'citas.eliminar');
  const id = v.uuid(event.pathParameters.id, 'id');
  await citaPermitida(usuario, id);
  const { error } = await supabase().from('appointments').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { ok: true });
});

module.exports.profesionalesSegun = profesionalesSegun;
module.exports.turnosLibres = turnosLibres;
module.exports.liberarReservasVencidas = liberarReservasVencidas;
module.exports.MAX_DIAS_BUSQUEDA = MAX_DIAS_BUSQUEDA;
