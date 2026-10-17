// Módulo Recepción: llegada de las mascotas (con cita o espontánea) y su
// atención hasta el cierre: observaciones -> prestaciones -> pago -> cierre.
// Solo se modifica una atención ABIERTA; el cierre es atómico (RPC close_visit).
const { supabase, errorDb } = require('../lib/supabase');
const { requerirPermiso, sucursalesDe, requerirSucursal, deLaOrganizacion } = require('../lib/acceso');
const { ahoraLocal } = require('../lib/disponibilidad');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');

const METODOS_PAGO = ['EFECTIVO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA'];

// Características de la mascota para el listado de recepción.
const COLUMNAS_MASCOTA = 'id, name, birth_date, weight, species:species(name), breed:breeds(name)';

const COLUMNAS =
  'id, branch_id, appointment_id, date, arrived_at, staff_id, specialty_id, client_id, pet_id, contact_name, ' +
  'contact_phone, pet_name, observations, status, closed_at, cancel_reason, created_at, ' +
  `client:clients(id, first_name, last_name, national_id, phone), pet:pets!visits_pet_id_fkey(${COLUMNAS_MASCOTA}), ` +
  'appointment:appointments(id, start_time, end_time, service_id), ' +
  'items:visit_items(id, service_id, description, quantity, unit_price, staff_id, created_at), ' +
  'payments:visit_payments(id, method, amount, reference, created_at)';

const COLUMNAS_CITA =
  'id, branch_id, staff_id, specialty_id, date, start_time, end_time, service_id, client_id, pet_id, contact_name, ' +
  'contact_phone, notes, status, client:clients(id, first_name, last_name, national_id, phone), ' +
  `pet:pets!appointments_pet_id_fkey(${COLUMNAS_MASCOTA}), visits(id, status)`;

const redondear = (n) => Math.round(n * 100) / 100;

// Totales calculados (la base guarda solo cantidades, precios y pagos).
function conTotales(a) {
  const total = redondear(a.items.reduce((s, i) => s + i.quantity * Number(i.unit_price), 0));
  const pagado = redondear(a.payments.reduce((s, p) => s + Number(p.amount), 0));
  return { ...a, total, pagado, saldo: redondear(total - pagado) };
}

async function obtener(id) {
  const { data, error } = await supabase().from('visits').select(COLUMNAS).eq('id', id).single();
  if (error) throw errorDb(error);
  return conTotales(data);
}

// Atención de la organización y de una sucursal del usuario.
async function atencionPermitida(usuario, id, { abierta = true } = {}) {
  const atencion = await deLaOrganizacion('visits', id, usuario, 'id, branch_id, status, appointment_id, staff_id, specialty_id');
  await requerirSucursal(usuario, atencion.branch_id);
  if (abierta && atencion.status !== 'ABIERTA') throw new HttpError(409, 'La atención ya está cerrada o anulada');
  return atencion;
}

// Quien atiende debe estar asignado a la sucursal de la atención.
async function profesional(staffId, branchId) {
  if (!staffId) return null;
  const { data, error } = await supabase()
    .from('staff_branches')
    .select('staff_id')
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .maybeSingle();
  if (error) throw errorDb(error);
  if (!data) throw new HttpError(400, 'Ese profesional no está asignado a la sucursal');
  return staffId;
}

// { staff_id, specialty_id } de la atención: especialidad de la organización
// y, si hay profesional, que la tenga asignada. `staffActual` (el que ya
// tenía, p. ej. el de la cita) no se revalida contra la sucursal.
async function quienAtiende(body, orgId, branchId, staffActual = null) {
  const pedido = v.uuid(body.staff_id, 'Profesional', { requerido: false });
  const staffId = pedido && pedido === staffActual ? pedido : await profesional(pedido, branchId);
  const specialtyId = v.uuid(body.specialty_id, 'Especialidad', { requerido: false });
  if (specialtyId) {
    await deLaOrganizacion('specialties', specialtyId, { organization_id: orgId });
    if (staffId) {
      const { data, error } = await supabase()
        .from('staff_specialties')
        .select('specialty_id')
        .eq('staff_id', staffId)
        .eq('specialty_id', specialtyId)
        .maybeSingle();
      if (error) throw errorDb(error);
      if (!data) throw new HttpError(400, 'Ese profesional no tiene esa especialidad');
    }
  }
  return { staff_id: staffId, specialty_id: specialtyId };
}

function errorAtencion(error) {
  if (error.code === '23505') return new HttpError(409, 'Esa cita ya fue recibida');
  return errorDb(error);
}

// GET /recepcion?fecha=&branchId=  -> citas del día (no canceladas) y atenciones del día
module.exports.listar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'recepcion.ver');
  const q = event.queryStringParameters || {};
  const fecha = v.fecha(q.fecha, 'fecha') || ahoraLocal().fecha;
  const branchId = q.branchId ? v.uuid(q.branchId, 'branchId') : null;
  const permitidas = await sucursalesDe(usuario);
  const org = usuario.organization_id;
  // Recepción trabaja sobre sucursales concretas: sin asignación no ve nada.
  if (permitidas && !permitidas.length) return json(200, { fecha, citas: [], atenciones: [], sinSucursal: true });

  const filtrar = (consulta) => {
    if (branchId) consulta = consulta.eq('branch_id', branchId);
    if (permitidas) consulta = consulta.in('branch_id', permitidas);
    return consulta;
  };

  const [citas, atenciones] = await Promise.all([
    filtrar(
      supabase()
        .from('appointments')
        .select(COLUMNAS_CITA)
        .eq('organization_id', org)
        .eq('date', fecha)
        .neq('status', 'CANCELADA')
        .order('start_time')
        .limit(500)
    ),
    filtrar(
      supabase()
        .from('visits')
        .select(COLUMNAS)
        .eq('organization_id', org)
        .eq('date', fecha)
        .order('arrived_at')
        .limit(500)
    ),
  ]);
  if (citas.error) throw errorDb(citas.error);
  if (atenciones.error) throw errorDb(atenciones.error);

  return json(200, {
    fecha,
    // La atención vigente de cada cita (las anuladas no cuentan).
    citas: citas.data.map(({ visits, ...c }) => ({ ...c, visit: visits.find((x) => x.status !== 'ANULADA') || null })),
    atenciones: atenciones.data.map(conTotales),
  });
});

// GET /atenciones/{id}
module.exports.obtener = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'recepcion.ver');
  const id = v.uuid(event.pathParameters.id, 'id');
  await atencionPermitida(usuario, id, { abierta: false });
  return json(200, { atencion: await obtener(id) });
});

// Datos de la mascota/tutor de una atención espontánea. Con ficha: tutor (y
// mascota suya). Sin ficha: nombre de contacto obligatorio.
async function pacienteEspontaneo(body, orgId) {
  const clientId = v.uuid(body.client_id, 'Tutor', { requerido: false });
  const petId = v.uuid(body.pet_id, 'Mascota', { requerido: false });
  const contactName = v.texto(body.contact_name, 'Nombre de contacto', { max: 120 });
  const contactPhone = v.texto(body.contact_phone, 'Teléfono', { max: 40 });
  const petName = v.texto(body.pet_name, 'Nombre de la mascota', { max: 80 });

  if (!clientId) {
    if (petId) throw new HttpError(400, 'Para indicar la mascota, elige primero el tutor');
    if (!contactName) throw new HttpError(400, 'Sin ficha, indica al menos el nombre del tutor');
    return { client_id: null, pet_id: null, contact_name: contactName, contact_phone: contactPhone, pet_name: petName };
  }

  const tutor = await deLaOrganizacion('clients', clientId, { organization_id: orgId }, 'id, first_name, last_name, phone');
  let mascota = null;
  if (petId) {
    const { data, error } = await supabase().from('pets').select('id, name').eq('id', petId).eq('client_id', clientId).maybeSingle();
    if (error) throw errorDb(error);
    if (!data) throw new HttpError(400, 'La mascota no pertenece a ese tutor');
    mascota = data;
  }
  return {
    client_id: clientId,
    pet_id: petId,
    contact_name: contactName || `${tutor.first_name} ${tutor.last_name}`,
    contact_phone: contactPhone || tutor.phone,
    pet_name: mascota?.name || petName,
  };
}

async function servicioDelCatalogo(serviceId, orgId) {
  return deLaOrganizacion('services_catalog', serviceId, { organization_id: orgId }, 'id, name, price, is_active');
}

// POST /atenciones
//   Con cita:   { appointment_id }  -> marca la llegada (cita LLEGO) y precarga su servicio.
//   Espontánea: { branch_id, client_id?, pet_id?, contact_name?, contact_phone?, pet_name?,
//                 staff_id?, observations? }
module.exports.crear = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'recepcion.crear');
  const body = parseJson(event);
  const org = usuario.organization_id;
  const hoy = ahoraLocal().fecha;
  const appointmentId = v.uuid(body.appointment_id, 'Cita', { requerido: false });

  let fila;
  let cita = null;
  if (appointmentId) {
    cita = await deLaOrganizacion(
      'appointments',
      appointmentId,
      usuario,
      'id, branch_id, staff_id, specialty_id, date, service_id, client_id, pet_id, contact_name, contact_phone, notes, ' +
        'status, pet:pets!appointments_pet_id_fkey(name)'
    );
    await requerirSucursal(usuario, cita.branch_id);
    if (cita.date !== hoy) throw new HttpError(400, 'Solo se puede recibir una cita del día de hoy');
    if (!['RESERVADA', 'CONFIRMADA', 'NO_ASISTIO'].includes(cita.status)) {
      throw new HttpError(409, 'Esa cita ya fue recibida, atendida o está cancelada');
    }
    fila = {
      branch_id: cita.branch_id,
      appointment_id: cita.id,
      staff_id: cita.staff_id,
      specialty_id: cita.specialty_id,
      client_id: cita.client_id,
      pet_id: cita.pet_id,
      contact_name: cita.contact_name,
      contact_phone: cita.contact_phone,
      pet_name: cita.pet?.name ?? null,
      observations: v.texto(body.observations, 'Observaciones', { max: 4000 }) || cita.notes,
    };
  } else {
    const branchId = v.uuid(body.branch_id, 'Sucursal');
    await requerirSucursal(usuario, branchId);
    await deLaOrganizacion('branches', branchId, usuario);
    fila = {
      branch_id: branchId,
      ...(await quienAtiende(body, org, branchId)),
      ...(await pacienteEspontaneo(body, org)),
      observations: v.texto(body.observations, 'Observaciones', { max: 4000 }),
    };
  }

  const { data, error } = await supabase()
    .from('visits')
    .insert({ ...fila, organization_id: org, date: hoy, created_by: usuario.id })
    .select('id')
    .single();
  if (error) throw errorAtencion(error);

  if (cita) {
    const { error: errorCita } = await supabase()
      .from('appointments')
      .update({ status: 'LLEGO', updated_at: new Date().toISOString() })
      .eq('id', cita.id);
    if (errorCita) throw errorDb(errorCita);

    // El servicio reservado queda como primera prestación (se puede quitar).
    if (cita.service_id) {
      const servicio = await servicioDelCatalogo(cita.service_id, org).catch(() => null);
      if (servicio) {
        const { error: errorItem } = await supabase().from('visit_items').insert({
          visit_id: data.id,
          organization_id: org,
          service_id: servicio.id,
          description: servicio.name,
          unit_price: servicio.price,
          staff_id: cita.staff_id,
          created_by: usuario.id,
        });
        if (errorItem) throw errorDb(errorItem);
      }
    }
  }
  return json(201, { atencion: await obtener(data.id) });
});

// PUT /atenciones/{id}  { observations, staff_id?, specialty_id? }
module.exports.actualizar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'recepcion.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const atencion = await atencionPermitida(usuario, id);
  const body = parseJson(event);
  // Lo que viene de la cita se conserva tal cual aunque el profesional ya
  // no esté en la sucursal; solo se valida lo que cambia.
  const sinCambio =
    (body.staff_id || null) === atencion.staff_id && (body.specialty_id || null) === atencion.specialty_id;
  const { error } = await supabase()
    .from('visits')
    .update({
      observations: v.texto(body.observations, 'Observaciones', { max: 4000 }),
      ...(sinCambio ? {} : await quienAtiende(body, usuario.organization_id, atencion.branch_id, atencion.staff_id)),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { atencion: await obtener(id) });
});

// POST /atenciones/{id}/prestaciones  { service_id?, description?, quantity?, unit_price?, staff_id? }
// Del catálogo (precio sugerido, se puede ajustar) o libre (descripción + precio).
module.exports.agregarPrestacion = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'recepcion.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const atencion = await atencionPermitida(usuario, id);
  const body = parseJson(event);
  const org = usuario.organization_id;
  const staffId = v.uuid(body.staff_id, 'Profesional', { requerido: false });
  const serviceId = v.uuid(body.service_id, 'Servicio', { requerido: false });
  const servicio = serviceId ? await servicioDelCatalogo(serviceId, org) : null;

  const description = v.texto(body.description, 'Descripción', { max: 200 }) || servicio?.name;
  if (!description) throw new HttpError(400, 'Elige un servicio o escribe la descripción');
  const unitPrice = v.numero(body.unit_price, 'Precio') ?? (servicio ? Number(servicio.price) : null);
  if (unitPrice == null) throw new HttpError(400, 'Precio: es obligatorio');

  const { error } = await supabase()
    .from('visit_items')
    .insert({
      visit_id: id,
      organization_id: org,
      service_id: serviceId,
      description,
      quantity: v.entero(body.quantity ?? 1, 'Cantidad', { min: 1, max: 999 }),
      unit_price: redondear(unitPrice),
      // El que atiende ya está validado; otro debe ser de la sucursal.
      staff_id: staffId === atencion.staff_id ? staffId : await profesional(staffId, atencion.branch_id),
      created_by: usuario.id,
    });
  if (error) throw errorDb(error);
  return json(201, { atencion: await obtener(id) });
});

// DELETE /atenciones/{id}/prestaciones/{itemId}
module.exports.quitarPrestacion = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'recepcion.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const itemId = v.uuid(event.pathParameters.itemId, 'itemId');
  await atencionPermitida(usuario, id);
  const { error } = await supabase().from('visit_items').delete().eq('id', itemId).eq('visit_id', id);
  if (error) throw errorDb(error);
  return json(200, { atencion: await obtener(id) });
});

// POST /atenciones/{id}/pagos  { method, amount, reference? }
// Se admite pagar en partes (varios medios); no se puede pagar más que el saldo.
module.exports.registrarPago = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'recepcion.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  await atencionPermitida(usuario, id);
  const body = parseJson(event);
  const amount = redondear(v.numero(body.amount, 'Monto', { requerido: true }));
  if (amount <= 0) throw new HttpError(400, 'Monto: debe ser mayor a 0');

  const { saldo } = await obtener(id);
  if (saldo <= 0) throw new HttpError(409, 'La atención no tiene saldo pendiente');
  if (amount > saldo) throw new HttpError(400, `El monto supera el saldo pendiente (${saldo})`);

  const { error } = await supabase()
    .from('visit_payments')
    .insert({
      visit_id: id,
      organization_id: usuario.organization_id,
      method: v.opcion(body.method, 'Medio de pago', METODOS_PAGO),
      amount,
      reference: v.texto(body.reference, 'Referencia', { max: 80 }),
      created_by: usuario.id,
    });
  if (error) throw errorDb(error);
  return json(201, { atencion: await obtener(id) });
});

// DELETE /atenciones/{id}/pagos/{pagoId}  (corregir un pago mal ingresado)
module.exports.quitarPago = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'recepcion.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const pagoId = v.uuid(event.pathParameters.pagoId, 'pagoId');
  await atencionPermitida(usuario, id);
  const { error } = await supabase().from('visit_payments').delete().eq('id', pagoId).eq('visit_id', id);
  if (error) throw errorDb(error);
  return json(200, { atencion: await obtener(id) });
});

// POST /atenciones/{id}/cerrar  -> exige prestaciones y el total pagado; la cita queda ATENDIDA.
module.exports.cerrar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'recepcion.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  await atencionPermitida(usuario, id);
  const { error } = await supabase().rpc('close_visit', {
    p_visit_id: id,
    p_organization_id: usuario.organization_id,
    p_user_id: usuario.id,
  });
  if (error) throw errorDb(error);
  return json(200, { atencion: await obtener(id) });
});

// POST /atenciones/{id}/anular  { reason? }  (llegada marcada por error)
// Sin pagos registrados; la cita vuelve a RESERVADA.
module.exports.anular = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'recepcion.eliminar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const atencion = await atencionPermitida(usuario, id);
  const { payments } = await obtener(id);
  if (payments.length) throw new HttpError(409, 'Tiene pagos registrados: quítalos antes de anular');

  const { error } = await supabase()
    .from('visits')
    .update({
      status: 'ANULADA',
      cancel_reason: v.texto(parseJson(event).reason, 'Motivo', { max: 300 }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw errorDb(error);

  if (atencion.appointment_id) {
    const { error: errorCita } = await supabase()
      .from('appointments')
      .update({ status: 'RESERVADA', updated_at: new Date().toISOString() })
      .eq('id', atencion.appointment_id)
      .eq('status', 'LLEGO');
    if (errorCita) throw errorDb(errorCita);
  }
  return json(200, { atencion: await obtener(id) });
});
