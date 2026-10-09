const { supabase, errorDb } = require('../lib/supabase');
const { requerirPersonal, requerirAdminOrg, sucursalesDe, deLaOrganizacion } = require('../lib/acceso');
const v = require('../lib/validar');
const { json, parseJson, handler } = require('../lib/http');

const COLUMNAS = 'id, name, address, phone, email, is_active, created_at';

function datos(body) {
  return {
    name: v.texto(body.name, 'Nombre', { requerido: true, max: 120 }),
    address: v.texto(body.address, 'Dirección'),
    phone: v.texto(body.phone, 'Teléfono', { max: 40 }),
    email: v.email(body.email, 'Email'),
    is_active: v.booleano(body.is_active),
  };
}

// GET /sucursales  -> admin: todas; especialista: solo las asignadas
module.exports.listar = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  let consulta = supabase()
    .from('branches')
    .select(COLUMNAS)
    .eq('organization_id', usuario.organization_id)
    .order('name');
  const permitidas = await sucursalesDe(usuario);
  if (permitidas) consulta = consulta.in('id', permitidas);

  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  return json(200, { sucursales: data });
});

// POST /sucursales
module.exports.crear = handler(async (event) => {
  const usuario = await requerirAdminOrg(event);
  const { data, error } = await supabase()
    .from('branches')
    .insert({ ...datos(parseJson(event)), organization_id: usuario.organization_id })
    .select(COLUMNAS)
    .single();
  if (error) throw errorDb(error);
  return json(201, { sucursal: data });
});

// PUT /sucursales/{id}
module.exports.actualizar = handler(async (event) => {
  const usuario = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('branches', id, usuario);

  const { data, error } = await supabase()
    .from('branches')
    .update(datos(parseJson(event)))
    .eq('id', id)
    .select(COLUMNAS)
    .single();
  if (error) throw errorDb(error);
  return json(200, { sucursal: data });
});

// DELETE /sucursales/{id}  (borra también sus asignaciones y agendas)
module.exports.eliminar = handler(async (event) => {
  const usuario = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('branches', id, usuario);

  const { error } = await supabase().from('branches').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { ok: true });
});
