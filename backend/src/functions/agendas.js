const { supabase, errorDb } = require('../lib/supabase');
const { requerirPersonal, requerirAdminOrg, sucursalesDe, deLaOrganizacion } = require('../lib/acceso');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');

const COLUMNAS = 'id, staff_id, branch_id, day_of_week, start_time, end_time, slot_duration_minutes, is_active';

function datos(body) {
  const bloque = {
    staff_id: v.uuid(body.staff_id, 'Profesional'),
    branch_id: v.uuid(body.branch_id, 'Sucursal'),
    day_of_week: v.entero(body.day_of_week, 'Día', { min: 0, max: 6 }),
    start_time: v.hora(body.start_time, 'Hora de inicio'),
    end_time: v.hora(body.end_time, 'Hora de término'),
    slot_duration_minutes: v.entero(body.slot_duration_minutes, 'Duración del turno', { min: 5, max: 480 }),
    is_active: v.booleano(body.is_active),
  };
  if (bloque.end_time <= bloque.start_time) throw new HttpError(400, 'La hora de término debe ser posterior a la de inicio');
  return bloque;
}

// Un profesional no puede tener dos bloques activos que se crucen el mismo
// día, aunque sean en sucursales distintas.
async function validarSinCruce(bloque, idActual) {
  if (!bloque.is_active) return;
  let consulta = supabase()
    .from('schedules')
    .select('start_time, end_time')
    .eq('staff_id', bloque.staff_id)
    .eq('day_of_week', bloque.day_of_week)
    .eq('is_active', true)
    .lt('start_time', bloque.end_time)
    .gt('end_time', bloque.start_time)
    .limit(1);
  if (idActual) consulta = consulta.neq('id', idActual);

  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  if (data.length) {
    const c = data[0];
    throw new HttpError(409, `Se cruza con otro bloque de ${c.start_time.slice(0, 5)} a ${c.end_time.slice(0, 5)} ese día`);
  }
}

// La FK (staff_id, branch_id) -> staff_branches da un error poco claro.
function errorAsignacion(error) {
  if (error.code === '23503') return new HttpError(400, 'El profesional no está asignado a esa sucursal');
  return errorDb(error);
}

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
  const usuario = await requerirAdminOrg(event);
  const bloque = datos(parseJson(event));
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
  const usuario = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('schedules', id, usuario);
  const bloque = datos(parseJson(event));
  await validarSinCruce(bloque, id);

  const { data, error } = await supabase().from('schedules').update(bloque).eq('id', id).select(COLUMNAS).single();
  if (error) throw errorAsignacion(error);
  return json(200, { agenda: data });
});

// DELETE /agendas/{id}
module.exports.eliminar = handler(async (event) => {
  const usuario = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('schedules', id, usuario);

  const { error } = await supabase().from('schedules').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { ok: true });
});
