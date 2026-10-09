const { supabase, errorDb } = require('../lib/supabase');
const { requerirPersonal, requerirAdminOrg, deLaOrganizacion } = require('../lib/acceso');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');

const COLUMNAS_MASCOTA = 'id, client_id, name, species_id, breed_id, birth_date, weight, microchip_number, notes';
const COLUMNAS_TUTOR = `id, national_id, first_name, last_name, phone, email, address, created_at, pets(${COLUMNAS_MASCOTA})`;

function datosTutor(body = {}) {
  return {
    national_id: v.texto(body.national_id, 'RUT / documento', { max: 20 }),
    first_name: v.texto(body.first_name, 'Nombre', { requerido: true, max: 80 }),
    last_name: v.texto(body.last_name, 'Apellido', { requerido: true, max: 80 }),
    phone: v.texto(body.phone, 'Teléfono', { max: 40 }),
    email: v.email(body.email, 'Email'),
    address: v.texto(body.address, 'Dirección'),
  };
}

function datosMascota(body = {}) {
  return {
    name: v.texto(body.name, 'Nombre de la mascota', { requerido: true, max: 80 }),
    species_id: v.uuid(body.species_id, 'Especie'),
    breed_id: v.uuid(body.breed_id, 'Raza', { requerido: false }),
    birth_date: v.fecha(body.birth_date, 'Fecha de nacimiento'),
    weight: v.numero(body.weight, 'Peso'),
    microchip_number: v.texto(body.microchip_number, 'Microchip', { max: 40 }),
    notes: v.texto(body.notes, 'Notas', { max: 2000 }),
  };
}

// La especie y la raza deben ser del catálogo base o de la organización
// (la FK de la base ya obliga a que la raza sea de esa especie).
async function validarCatalogo(mascotas, org) {
  const especies = [...new Set(mascotas.map((m) => m.species_id))];
  const razas = [...new Set(mascotas.map((m) => m.breed_id).filter(Boolean))];
  const visibles = `organization_id.is.null,organization_id.eq.${org}`;

  const { data: e, error: errorE } = await supabase().from('species').select('id').in('id', especies).or(visibles);
  if (errorE) throw errorDb(errorE);
  if (e.length !== especies.length) throw new HttpError(400, 'Especie no válida');

  if (razas.length) {
    const { data: r, error: errorR } = await supabase().from('breeds').select('id').in('id', razas).or(visibles);
    if (errorR) throw errorDb(errorR);
    if (r.length !== razas.length) throw new HttpError(400, 'Raza no válida');
  }
}

// Mensajes claros para los choques de unicidad.
function errorTutor(error) {
  if (error.code === '23505' && /national_id/.test(error.message)) {
    return new HttpError(409, 'Ya existe un tutor con ese RUT / documento');
  }
  if (error.code === '23505' && /microchip/.test(error.message)) {
    return new HttpError(409, 'Ya existe una mascota con ese número de microchip');
  }
  if (error.code === '23503' && /breed/.test(error.message)) return new HttpError(400, 'La raza no corresponde a la especie');
  return errorDb(error);
}

async function obtenerTutor(id, org) {
  const { data, error } = await supabase()
    .from('clients')
    .select(COLUMNAS_TUTOR)
    .eq('id', id)
    .eq('organization_id', org)
    .maybeSingle();
  if (error) throw errorDb(error);
  if (!data) throw new HttpError(404, 'Tutor no encontrado');
  return data;
}

// GET /tutores?q=texto  -> busca por nombre, apellido, RUT o email (máx. 50)
module.exports.listar = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  // Se quitan los caracteres con significado en el filtro de PostgREST.
  const q = String((event.queryStringParameters || {}).q || '')
    .replace(/[,()*%\\:"]/g, ' ')
    .trim()
    .slice(0, 60);

  let consulta = supabase()
    .from('clients')
    .select(COLUMNAS_TUTOR)
    .eq('organization_id', usuario.organization_id)
    .order('last_name')
    .order('first_name')
    .limit(50);
  if (q) {
    const p = `%${q}%`;
    consulta = consulta.or(`first_name.ilike.${p},last_name.ilike.${p},national_id.ilike.${p},email.ilike.${p}`);
  }

  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  return json(200, { tutores: data });
});

// GET /tutores/{id}
module.exports.obtener = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  return json(200, { tutor: await obtenerTutor(v.uuid(event.pathParameters.id, 'id'), usuario.organization_id) });
});

// POST /tutores  { tutor: {...}, mascotas: [{...}] }  -> tutor + mascotas en una transacción
module.exports.crear = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  const body = parseJson(event);
  const tutor = datosTutor(body.tutor);
  if (body.mascotas != null && !Array.isArray(body.mascotas)) throw new HttpError(400, 'mascotas debe ser una lista');
  const mascotas = (body.mascotas || []).map(datosMascota);
  if (mascotas.length > 20) throw new HttpError(400, 'Máximo 20 mascotas por registro');
  if (mascotas.length) await validarCatalogo(mascotas, usuario.organization_id);

  const { data: id, error } = await supabase().rpc('create_client_with_pets', {
    p_organization_id: usuario.organization_id,
    p_client: tutor,
    p_pets: mascotas,
  });
  if (error) throw errorTutor(error);
  return json(201, { tutor: await obtenerTutor(id, usuario.organization_id) });
});

// PUT /tutores/{id}
module.exports.actualizar = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('clients', id, usuario);

  const { error } = await supabase().from('clients').update(datosTutor(parseJson(event))).eq('id', id);
  if (error) throw errorTutor(error);
  return json(200, { tutor: await obtenerTutor(id, usuario.organization_id) });
});

// DELETE /tutores/{id}  (borra también sus mascotas)
module.exports.eliminar = handler(async (event) => {
  const usuario = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('clients', id, usuario);
  const { error } = await supabase().from('clients').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { ok: true });
});

// POST /tutores/{id}/mascotas
module.exports.agregarMascota = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  const clientId = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('clients', clientId, usuario);
  const mascota = datosMascota(parseJson(event));
  await validarCatalogo([mascota], usuario.organization_id);

  const { data, error } = await supabase()
    .from('pets')
    .insert({ ...mascota, client_id: clientId, organization_id: usuario.organization_id })
    .select(COLUMNAS_MASCOTA)
    .single();
  if (error) throw errorTutor(error);
  return json(201, { mascota: data });
});

// PUT /mascotas/{id}
module.exports.actualizarMascota = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('pets', id, usuario);
  const mascota = datosMascota(parseJson(event));
  await validarCatalogo([mascota], usuario.organization_id);

  const { data, error } = await supabase().from('pets').update(mascota).eq('id', id).select(COLUMNAS_MASCOTA).single();
  if (error) throw errorTutor(error);
  return json(200, { mascota: data });
});

// DELETE /mascotas/{id}
module.exports.eliminarMascota = handler(async (event) => {
  const usuario = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('pets', id, usuario);
  const { error } = await supabase().from('pets').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { ok: true });
});
