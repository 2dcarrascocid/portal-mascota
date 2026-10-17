// Agendas: bloques semanales (schedules) con vigencia, excepciones
// (schedule_exceptions) y herramientas de mantención. La disponibilidad
// resultante se calcula en lib/disponibilidad.js.
const { supabase, errorDb } = require('../lib/supabase');
const { requerirPersonal, requerirPermiso, sucursalesDe, requerirSucursal, deLaOrganizacion } = require('../lib/acceso');
const d = require('../lib/disponibilidad');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');

const COLUMNAS =
  'id, staff_id, branch_id, day_of_week, start_time, end_time, slot_duration_minutes, valid_from, valid_to, is_active';
const COLUMNAS_EXCEPCION =
  'id, type, staff_id, branch_id, start_date, end_date, start_time, end_time, slot_duration_minutes, reason, created_at';
const TIPOS_EXCEPCION = ['BLOQUEO', 'HORARIO_EXTRA', 'CAMBIO_HORARIO'];
const MAX_DIAS_EXCEPCION = 366;
const MAX_DIAS_DISPONIBILIDAD = 62;

const hhmm = (t) => t.slice(0, 5);

function vigencia(body) {
  const valid_from = v.fecha(body.valid_from, 'Vigente desde');
  const valid_to = v.fecha(body.valid_to, 'Vigente hasta');
  if (valid_from && valid_to && valid_to < valid_from) throw new HttpError(400, 'La vigencia termina antes de empezar');
  return { valid_from, valid_to };
}

function datos(body) {
  const bloque = {
    staff_id: v.uuid(body.staff_id, 'Profesional'),
    branch_id: v.uuid(body.branch_id, 'Sucursal'),
    day_of_week: v.entero(body.day_of_week, 'Día', { min: 0, max: 6 }),
    start_time: v.hora(body.start_time, 'Hora de inicio'),
    end_time: v.hora(body.end_time, 'Hora de término'),
    slot_duration_minutes: v.entero(body.slot_duration_minutes, 'Duración del turno', { min: 5, max: 480 }),
    ...vigencia(body),
    is_active: v.booleano(body.is_active),
  };
  if (bloque.end_time <= bloque.start_time) throw new HttpError(400, 'La hora de término debe ser posterior a la de inicio');
  return bloque;
}

// Un profesional no puede tener dos bloques activos que se crucen el mismo
// día y en vigencias que se superponen, aunque sean en sucursales distintas.
// `otros`: bloques adicionales aún no guardados (copia masiva).
async function validarSinCruce(bloque, idActual, otros = []) {
  if (!bloque.is_active) return;
  let consulta = supabase()
    .from('schedules')
    .select('start_time, end_time, valid_from, valid_to')
    .eq('staff_id', bloque.staff_id)
    .eq('day_of_week', bloque.day_of_week)
    .eq('is_active', true)
    .lt('start_time', bloque.end_time)
    .gt('end_time', bloque.start_time);
  if (idActual) consulta = consulta.neq('id', idActual);

  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  const pendientes = otros.filter(
    (o) => o.day_of_week === bloque.day_of_week && o.start_time < bloque.end_time && o.end_time > bloque.start_time
  );
  const c = [...data, ...pendientes].find((x) => d.vigenciasSeCruzan(x, bloque));
  if (c) throw new HttpError(409, `Se cruza con otro bloque de ${hhmm(c.start_time)} a ${hhmm(c.end_time)} ese día`);
}

// La FK (staff_id, branch_id) -> staff_branches da un error poco claro.
function errorAsignacion(error) {
  if (error.code === '23503') return new HttpError(400, 'El profesional no está asignado a esa sucursal');
  return errorDb(error);
}

// ── Bloques semanales ────────────────────────────────────────

// GET /agendas?branchId=&staffId=
module.exports.listar = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  const q = event.queryStringParameters || {};
  let consulta = supabase()
    .from('schedules')
    .select(COLUMNAS)
    .eq('organization_id', usuario.organization_id)
    .order('day_of_week')
    .order('start_time');
  if (q.branchId) consulta = consulta.eq('branch_id', v.uuid(q.branchId, 'branchId'));
  if (q.staffId) consulta = consulta.eq('staff_id', v.uuid(q.staffId, 'staffId'));
  const permitidas = await sucursalesDe(usuario);
  if (permitidas) consulta = consulta.in('branch_id', permitidas);

  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  return json(200, { agendas: data });
});

// POST /agendas
module.exports.crear = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'agendas.crear');
  const bloque = datos(parseJson(event));
  await requerirSucursal(usuario, bloque.branch_id);
  await validarSinCruce(bloque);

  const { data, error } = await supabase()
    .from('schedules')
    .insert({ ...bloque, organization_id: usuario.organization_id })
    .select(COLUMNAS)
    .single();
  if (error) throw errorAsignacion(error);
  return json(201, { agenda: data });
});

// PUT /agendas/{id}
module.exports.actualizar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'agendas.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const actual = await deLaOrganizacion('schedules', id, usuario, 'id, branch_id');
  await requerirSucursal(usuario, actual.branch_id);
  const bloque = datos(parseJson(event));
  await requerirSucursal(usuario, bloque.branch_id);
  await validarSinCruce(bloque, id);

  const { data, error } = await supabase().from('schedules').update(bloque).eq('id', id).select(COLUMNAS).single();
  if (error) throw errorAsignacion(error);
  return json(200, { agenda: data });
});

// DELETE /agendas/{id}
module.exports.eliminar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'agendas.eliminar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const actual = await deLaOrganizacion('schedules', id, usuario, 'id, branch_id');
  await requerirSucursal(usuario, actual.branch_id);

  const { error } = await supabase().from('schedules').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { ok: true });
});

// POST /agendas/copiar  { from_staff_id, to_staff_id, branch_id, valid_from?, valid_to? }
// Copia los bloques semanales de un profesional en una sucursal a otro
// profesional (asignado a esa sucursal). Todo o nada: si alguno choca, no
// se copia ninguno.
module.exports.copiar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'agendas.crear');
  const body = parseJson(event);
  const origen = v.uuid(body.from_staff_id, 'Profesional de origen');
  const destino = v.uuid(body.to_staff_id, 'Profesional de destino');
  const branchId = v.uuid(body.branch_id, 'Sucursal');
  if (origen === destino) throw new HttpError(400, 'Elige dos profesionales distintos');
  await requerirSucursal(usuario, branchId);
  // Vigencia nueva opcional; si no viene, se conserva la de cada bloque.
  const nuevaVigencia = body.valid_from || body.valid_to ? vigencia(body) : null;

  const { data: fuente, error } = await supabase()
    .from('schedules')
    .select(COLUMNAS)
    .eq('organization_id', usuario.organization_id)
    .eq('staff_id', origen)
    .eq('branch_id', branchId);
  if (error) throw errorDb(error);
  if (!fuente.length) throw new HttpError(400, 'El profesional de origen no tiene horarios en esa sucursal');

  const copias = fuente.map(({ id, ...b }) => ({
    ...b,
    ...(nuevaVigencia || {}),
    staff_id: destino,
    organization_id: usuario.organization_id,
  }));
  for (const [i, copia] of copias.entries()) {
    try {
      await validarSinCruce(copia, null, copias.slice(0, i).filter((o) => o.is_active));
    } catch (err) {
      if (err instanceof HttpError) {
        const dia = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][copia.day_of_week];
        throw new HttpError(err.statusCode, `El ${dia} de ${hhmm(copia.start_time)} a ${hhmm(copia.end_time)}: ${err.message}`);
      }
      throw err;
    }
  }

  const { data, error: errorInsert } = await supabase().from('schedules').insert(copias).select(COLUMNAS);
  if (errorInsert) throw errorAsignacion(errorInsert);
  return json(201, { agendas: data });
});

// ── Excepciones ──────────────────────────────────────────────

function datosExcepcion(body) {
  const e = {
    type: v.opcion(body.type, 'Tipo', TIPOS_EXCEPCION),
    staff_id: v.uuid(body.staff_id, 'Profesional', { requerido: false }),
    branch_id: v.uuid(body.branch_id, 'Sucursal', { requerido: false }),
    start_date: v.fecha(body.start_date, 'Desde'),
    end_date: v.fecha(body.end_date, 'Hasta') || v.fecha(body.start_date, 'Desde'),
    start_time: body.start_time ? v.hora(body.start_time, 'Hora de inicio') : null,
    end_time: body.end_time ? v.hora(body.end_time, 'Hora de término') : null,
    slot_duration_minutes: v.entero(body.slot_duration_minutes, 'Duración del turno', { min: 5, max: 480, requerido: false }),
    reason: v.texto(body.reason, 'Motivo', { max: 200 }),
  };
  if (!e.start_date) throw new HttpError(400, 'Desde: es obligatorio');
  if (e.end_date < e.start_date) throw new HttpError(400, 'La fecha de término es anterior a la de inicio');
  if (d.diasEntre(e.start_date, e.end_date) >= MAX_DIAS_EXCEPCION) {
    throw new HttpError(400, `Una excepción puede abarcar como máximo ${MAX_DIAS_EXCEPCION} días`);
  }
  if (!e.start_time !== !e.end_time) throw new HttpError(400, 'Indica hora de inicio y de término, o ninguna (día completo)');
  if (e.start_time && e.end_time <= e.start_time) throw new HttpError(400, 'La hora de término debe ser posterior a la de inicio');
  if (e.type === 'BLOQUEO') {
    e.slot_duration_minutes = null;
  } else {
    if (!e.staff_id || !e.branch_id) throw new HttpError(400, 'Indica el profesional y la sucursal');
    if (!e.start_time) throw new HttpError(400, 'Indica el horario de atención');
    if (!e.slot_duration_minutes) throw new HttpError(400, 'Duración del turno: es obligatoria');
  }
  return e;
}

// Un horario extra o cambio no puede chocar con lo que el profesional ya
// atiende en otra sucursal esas fechas.
async function validarExcepcion(e, usuario, idActual) {
  if (e.type === 'BLOQUEO') return;
  const [bloques, excepciones] = await Promise.all([
    cargarBloques(usuario.organization_id, { staffId: e.staff_id }),
    cargarExcepciones(usuario.organization_id, e.start_date, e.end_date, { staffId: e.staff_id }),
  ]);
  const cruce = d.cruceEnOtraSucursal({
    bloques,
    excepciones: excepciones.filter((x) => x.id !== idActual),
    staffId: e.staff_id,
    branchId: e.branch_id,
    desde: e.start_date,
    hasta: e.end_date,
    inicio: d.aMinutos(e.start_time),
    fin: d.aMinutos(e.end_time),
  });
  if (cruce) {
    throw new HttpError(409, `El ${cruce.fecha} ya atiende de ${cruce.inicio} a ${cruce.fin} en otra sucursal`);
  }
}

function errorExcepcion(error) {
  if (error.code === '23503') return new HttpError(400, 'El profesional no está asignado a esa sucursal');
  return errorDb(error);
}

async function cargarBloques(orgId, { staffId, branchId } = {}) {
  let consulta = supabase().from('schedules').select(COLUMNAS).eq('organization_id', orgId).eq('is_active', true);
  if (staffId) consulta = consulta.eq('staff_id', staffId);
  if (branchId) consulta = consulta.eq('branch_id', branchId);
  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  return data;
}

// Excepciones que tocan [desde, hasta]. Con staffId/branchId incluye también
// las de alcance general (null), que aplican a todos.
async function cargarExcepciones(orgId, desde, hasta, { staffId, branchId } = {}) {
  let consulta = supabase()
    .from('schedule_exceptions')
    .select(COLUMNAS_EXCEPCION)
    .eq('organization_id', orgId)
    .order('start_date')
    .order('start_time', { nullsFirst: true });
  if (desde) consulta = consulta.gte('end_date', desde);
  if (hasta) consulta = consulta.lte('start_date', hasta);
  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  return data.filter(
    (e) => (!staffId || !e.staff_id || e.staff_id === staffId) && (!branchId || !e.branch_id || e.branch_id === branchId)
  );
}

// GET /agendas/excepciones?desde=&hasta=&staffId=&branchId=
module.exports.listarExcepciones = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  const q = event.queryStringParameters || {};
  let excepciones = await cargarExcepciones(usuario.organization_id, v.fecha(q.desde, 'desde'), v.fecha(q.hasta, 'hasta'), {
    staffId: q.staffId && v.uuid(q.staffId, 'staffId'),
    branchId: q.branchId && v.uuid(q.branchId, 'branchId'),
  });
  const permitidas = await sucursalesDe(usuario);
  if (permitidas) excepciones = excepciones.filter((e) => !e.branch_id || permitidas.includes(e.branch_id));
  return json(200, { excepciones });
});

// POST /agendas/excepciones
module.exports.crearExcepcion = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'agendas.crear');
  const e = datosExcepcion(parseJson(event));
  await requerirSucursal(usuario, e.branch_id);
  await validarExcepcion(e, usuario);

  const { data, error } = await supabase()
    .from('schedule_exceptions')
    .insert({ ...e, organization_id: usuario.organization_id, created_by: usuario.id })
    .select(COLUMNAS_EXCEPCION)
    .single();
  if (error) throw errorExcepcion(error);
  return json(201, { excepcion: data });
});

// PUT /agendas/excepciones/{id}
module.exports.actualizarExcepcion = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'agendas.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const actual = await deLaOrganizacion('schedule_exceptions', id, usuario, 'id, branch_id');
  await requerirSucursal(usuario, actual.branch_id);
  const e = datosExcepcion(parseJson(event));
  await requerirSucursal(usuario, e.branch_id);
  await validarExcepcion(e, usuario, id);

  const { data, error } = await supabase()
    .from('schedule_exceptions')
    .update(e)
    .eq('id', id)
    .select(COLUMNAS_EXCEPCION)
    .single();
  if (error) throw errorExcepcion(error);
  return json(200, { excepcion: data });
});

// DELETE /agendas/excepciones/{id}
module.exports.eliminarExcepcion = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'agendas.eliminar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const actual = await deLaOrganizacion('schedule_exceptions', id, usuario, 'id, branch_id');
  await requerirSucursal(usuario, actual.branch_id);
  const { error } = await supabase().from('schedule_exceptions').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { ok: true });
});

// POST /agendas/mover-dia  { staff_id, branch_id?, desde, hacia, reason? }
// Traslada la atención de un día a otro: bloquea `desde` y crea horarios
// extra en `hacia` con los mismos tramos. Se guarda en un solo insert.
module.exports.moverDia = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'agendas.crear');
  const body = parseJson(event);
  const staffId = v.uuid(body.staff_id, 'Profesional');
  const branchId = v.uuid(body.branch_id, 'Sucursal', { requerido: false });
  const desde = v.fecha(body.desde, 'Día original');
  const hacia = v.fecha(body.hacia, 'Día nuevo');
  if (!desde || !hacia) throw new HttpError(400, 'Indica el día original y el día nuevo');
  if (desde === hacia) throw new HttpError(400, 'Elige dos días distintos');
  const motivo = v.texto(body.reason, 'Motivo', { max: 200 });

  const [bloques, excepciones] = await Promise.all([
    cargarBloques(usuario.organization_id, { staffId, branchId }),
    cargarExcepciones(usuario.organization_id, desde, desde, { staffId }),
  ]);
  const pares = d
    .intervalosDelDia(bloques, excepciones, desde)
    .filter((p) => p.staff_id === staffId && (!branchId || p.branch_id === branchId));
  if (!pares.length) throw new HttpError(400, `No tiene atención el ${desde}`);
  for (const p of pares) await requerirSucursal(usuario, p.branch_id);

  const base = { organization_id: usuario.organization_id, staff_id: staffId, created_by: usuario.id };
  const filas = pares.flatMap((p) =>
    p.intervalos.map((i) => ({
      ...base,
      type: 'HORARIO_EXTRA',
      branch_id: p.branch_id,
      start_date: hacia,
      end_date: hacia,
      start_time: d.aHora(i.inicio),
      end_time: d.aHora(i.fin),
      slot_duration_minutes: i.turno,
      reason: motivo || `Trasladado desde el ${desde}`,
    }))
  );
  for (const f of filas) await validarExcepcion(f, usuario);
  // Un bloqueo de día completo por cada sucursal donde atendía ese día.
  for (const p of pares) {
    filas.push({
      ...base,
      type: 'BLOQUEO',
      branch_id: p.branch_id,
      start_date: desde,
      end_date: desde,
      reason: motivo || `Trasladado al ${hacia}`,
    });
  }

  const { data, error } = await supabase().from('schedule_exceptions').insert(filas).select(COLUMNAS_EXCEPCION);
  if (error) throw errorExcepcion(error);
  return json(201, { excepciones: data });
});

// ── Disponibilidad ───────────────────────────────────────────

// GET /agendas/disponibilidad?desde=&hasta=&staffId=&branchId=
module.exports.disponibilidad = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  const q = event.queryStringParameters || {};
  const desde = v.fecha(q.desde, 'desde');
  const hasta = v.fecha(q.hasta, 'hasta');
  if (!desde || !hasta) throw new HttpError(400, 'Indica desde y hasta');
  if (hasta < desde) throw new HttpError(400, 'El rango de fechas está invertido');
  if (d.diasEntre(desde, hasta) >= MAX_DIAS_DISPONIBILIDAD) {
    throw new HttpError(400, `Consulta como máximo ${MAX_DIAS_DISPONIBILIDAD} días`);
  }
  const filtros = {
    staffId: q.staffId && v.uuid(q.staffId, 'staffId'),
    branchId: q.branchId && v.uuid(q.branchId, 'branchId'),
  };

  let [bloques, excepciones] = await Promise.all([
    cargarBloques(usuario.organization_id, filtros),
    cargarExcepciones(usuario.organization_id, desde, hasta, filtros),
  ]);
  const permitidas = await sucursalesDe(usuario);
  if (permitidas) bloques = bloques.filter((b) => permitidas.includes(b.branch_id));
  // Los extras/cambios de otros profesionales o sucursales no aplican aquí.
  excepciones = excepciones.filter(
    (e) =>
      e.type === 'BLOQUEO' ||
      ((!filtros.staffId || e.staff_id === filtros.staffId) &&
        (!filtros.branchId || e.branch_id === filtros.branchId) &&
        (!permitidas || permitidas.includes(e.branch_id)))
  );

  return json(200, { dias: d.disponibilidad({ bloques, excepciones, desde, hasta }) });
});

// Reutilizadas por el módulo de citas (functions/citas.js).
module.exports.cargarBloques = cargarBloques;
module.exports.cargarExcepciones = cargarExcepciones;
