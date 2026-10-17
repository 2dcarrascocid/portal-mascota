// Catálogo de especialidades de la organización (se asignan al personal).
const { supabase, errorDb } = require('../lib/supabase');
const { requerirPersonal, requerirPermiso, deLaOrganizacion } = require('../lib/acceso');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');

const COLUMNAS = 'id, name, description, is_active, created_at, staff_specialties(count), specialty_services(count)';

// Los (count) llegan como [{ count: n }].
const aPublico = ({ staff_specialties: personal, specialty_services: servicios, ...e }) => ({
  ...e,
  total_personal: personal?.[0]?.count ?? 0,
  total_servicios: servicios?.[0]?.count ?? 0,
});

function datos(body) {
  return {
    name: v.texto(body.name, 'Nombre', { requerido: true, max: 80 }),
    description: v.texto(body.description, 'Descripción', { requerido: true, max: 500 }),
    is_active: v.booleano(body.is_active),
  };
}

function errorEspecialidad(error) {
  if (error.code === '23505') return new HttpError(409, 'Ya existe una especialidad con ese nombre');
  return errorDb(error);
}

// GET /especialidades  -> todas las de la organización, con cuántas personas la tienen
module.exports.listar = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  const { data, error } = await supabase()
    .from('specialties')
    .select(COLUMNAS)
    .eq('organization_id', usuario.organization_id)
    .order('name');
  if (error) throw errorDb(error);
  return json(200, { especialidades: data.map(aPublico) });
});

// POST /especialidades
module.exports.crear = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'especialidades.crear');
  const { data, error } = await supabase()
    .from('specialties')
    .insert({ ...datos(parseJson(event)), organization_id: usuario.organization_id })
    .select(COLUMNAS)
    .single();
  if (error) throw errorEspecialidad(error);
  return json(201, { especialidad: aPublico(data) });
});

// PUT /especialidades/{id}
module.exports.actualizar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'especialidades.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('specialties', id, usuario);
  const { data, error } = await supabase()
    .from('specialties')
    .update(datos(parseJson(event)))
    .eq('id', id)
    .select(COLUMNAS)
    .single();
  if (error) throw errorEspecialidad(error);
  return json(200, { especialidad: aPublico(data) });
});

// DELETE /especialidades/{id}  (se quita también al personal que la tenía)
module.exports.eliminar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'especialidades.eliminar');
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('specialties', id, usuario);
  const { error } = await supabase().from('specialties').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { ok: true });
});
