const { supabase, errorDb } = require('../lib/supabase');
const { requerirPersonal, requerirPermiso, deLaOrganizacion } = require('../lib/acceso');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');

const CATEGORIAS = ['GROOMING', 'VET', 'TRAINING'];

// Al borrar una especie o raza en uso, la FK de pets lo impide.
function errorEnUso(error) {
  if (error.code === '23503') return new HttpError(409, 'No se puede eliminar: hay mascotas registradas con ella');
  return errorDb(error);
}

// ── Especies y razas ─────────────────────────────────────────
// Visibles: las del catálogo base (organization_id null) + las propias.
// Editables: solo las propias.

const visible = (fila, org) => fila.organization_id === null || fila.organization_id === org;

// GET /especies  -> [{ id, name, propia, razas: [{ id, name, propia }] }]
module.exports.listarEspecies = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  const org = usuario.organization_id;
  const { data, error } = await supabase()
    .from('species')
    .select('id, name, organization_id, breeds(id, name, organization_id)')
    .or(`organization_id.is.null,organization_id.eq.${org}`)
    .order('name');
  if (error) throw errorDb(error);

  const especies = data.map((e) => ({
    id: e.id,
    name: e.name,
    propia: e.organization_id === org,
    razas: e.breeds
      .filter((r) => visible(r, org))
      .map((r) => ({ id: r.id, name: r.name, propia: r.organization_id === org }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  }));
  return json(200, { especies });
});

// POST /especies  { name }
module.exports.crearEspecie = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'especies.crear');
  const { data, error } = await supabase()
    .from('species')
    .insert({ name: v.texto(parseJson(event).name, 'Nombre', { requerido: true, max: 60 }), organization_id: usuario.organization_id })
    .select('id, name')
    .single();
  if (error) throw errorDb(error);
  return json(201, { especie: { ...data, propia: true, razas: [] } });
});

// DELETE /especies/{id}  (solo propias)
module.exports.eliminarEspecie = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'especies.eliminar');
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('species', id, usuario);
  const { error } = await supabase().from('species').delete().eq('id', id);
  if (error) throw errorEnUso(error);
  return json(200, { ok: true });
});

// POST /especies/{id}/razas  { name }  (a especies base o propias)
module.exports.crearRaza = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'especies.crear');
  const especieId = v.uuid(event.pathParameters.id, 'id');
  const { data: especie, error: errorEspecie } = await supabase()
    .from('species')
    .select('id, organization_id')
    .eq('id', especieId)
    .maybeSingle();
  if (errorEspecie) throw errorDb(errorEspecie);
  if (!especie || !visible(especie, usuario.organization_id)) throw new HttpError(404, 'Especie no encontrada');

  const { data, error } = await supabase()
    .from('breeds')
    .insert({
      species_id: especieId,
      organization_id: usuario.organization_id,
      name: v.texto(parseJson(event).name, 'Nombre', { requerido: true, max: 80 }),
    })
    .select('id, name')
    .single();
  if (error) throw errorDb(error);
  return json(201, { raza: { ...data, propia: true } });
});

// DELETE /razas/{id}  (solo propias)
module.exports.eliminarRaza = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'especies.eliminar');
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('breeds', id, usuario);
  const { error } = await supabase().from('breeds').delete().eq('id', id);
  if (error) throw errorEnUso(error);
  return json(200, { ok: true });
});

// ── Catálogo de servicios ────────────────────────────────────
// Cada servicio se asigna a una o más especialidades (specialty_services).

const COLUMNAS_SERVICIO =
  'id, category, name, description, price, duration_minutes, is_active, specialty_services(specialty_id)';

const servicioPublico = ({ specialty_services: asignaciones, ...s }) => ({
  ...s,
  specialty_ids: (asignaciones || []).map((a) => a.specialty_id),
});

function datosServicio(body) {
  return {
    category: v.opcion(body.category, 'Categoría', CATEGORIAS),
    name: v.texto(body.name, 'Nombre', { requerido: true, max: 120 }),
    description: v.texto(body.description, 'Descripción', { max: 1000 }),
    price: v.numero(body.price, 'Precio', { requerido: true }),
    duration_minutes: v.entero(body.duration_minutes, 'Duración', { min: 5, max: 1440 }),
    is_active: v.booleano(body.is_active),
  };
}

function idsEspecialidades(lista) {
  if (lista === undefined) return undefined;
  if (!Array.isArray(lista)) throw new HttpError(400, 'Especialidades: debe ser una lista');
  return [...new Set(lista.map((x) => v.uuid(x, 'Especialidad')))];
}

// Reemplaza las especialidades del servicio. La FK compuesta rechaza
// especialidades de otra organización.
async function guardarEspecialidades(serviceId, orgId, ids) {
  const db = supabase();
  let quitar = db.from('specialty_services').delete().eq('service_id', serviceId);
  if (ids.length) quitar = quitar.not('specialty_id', 'in', `(${ids.join(',')})`);
  const { error: errorQuitar } = await quitar;
  if (errorQuitar) throw errorDb(errorQuitar);

  if (ids.length) {
    const { error } = await db
      .from('specialty_services')
      .upsert(
        ids.map((id) => ({ service_id: serviceId, specialty_id: id, organization_id: orgId })),
        { onConflict: 'specialty_id,service_id', ignoreDuplicates: true }
      );
    if (error) throw errorDb(error);
  }
}

async function obtenerServicio(id) {
  const { data, error } = await supabase().from('services_catalog').select(COLUMNAS_SERVICIO).eq('id', id).single();
  if (error) throw errorDb(error);
  return servicioPublico(data);
}

// GET /servicios?category=GROOMING&specialtyId=
module.exports.listarServicios = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  const { category, specialtyId } = event.queryStringParameters || {};
  let consulta = supabase()
    .from('services_catalog')
    .select(COLUMNAS_SERVICIO)
    .eq('organization_id', usuario.organization_id)
    .order('category')
    .order('name');
  if (category) consulta = consulta.eq('category', v.opcion(category, 'category', CATEGORIAS));

  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  let servicios = data.map(servicioPublico);
  if (specialtyId) servicios = servicios.filter((s) => s.specialty_ids.includes(specialtyId));
  return json(200, { servicios });
});

// POST /servicios  { ...servicio, specialtyIds? }
module.exports.crearServicio = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'servicios.crear');
  const body = parseJson(event);
  const datos = datosServicio(body);
  const especialidades = idsEspecialidades(body.specialtyIds);
  const { data, error } = await supabase()
    .from('services_catalog')
    .insert({ ...datos, organization_id: usuario.organization_id })
    .select('id')
    .single();
  if (error) throw errorDb(error);
  if (especialidades?.length) await guardarEspecialidades(data.id, usuario.organization_id, especialidades);
  return json(201, { servicio: await obtenerServicio(data.id) });
});

// PUT /servicios/{id}  { ...servicio, specialtyIds? }  (sin specialtyIds no se tocan)
module.exports.actualizarServicio = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'servicios.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('services_catalog', id, usuario);
  const body = parseJson(event);
  const datos = datosServicio(body);
  const especialidades = idsEspecialidades(body.specialtyIds);
  const { error } = await supabase().from('services_catalog').update(datos).eq('id', id);
  if (error) throw errorDb(error);
  if (especialidades) await guardarEspecialidades(id, usuario.organization_id, especialidades);
  return json(200, { servicio: await obtenerServicio(id) });
});

// DELETE /servicios/{id}
module.exports.eliminarServicio = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'servicios.eliminar');
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('services_catalog', id, usuario);
  const { error } = await supabase().from('services_catalog').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { ok: true });
});
