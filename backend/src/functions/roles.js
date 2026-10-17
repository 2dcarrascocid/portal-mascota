// Roles configurables de la organización: un nombre + permisos por módulo.
// Solo el ORG_ADMIN los administra y asigna (ver lib/permisos.js).
const { supabase, errorDb } = require('../lib/supabase');
const { requerirAdminOrg, deLaOrganizacion } = require('../lib/acceso');
const { ACCIONES, MODULOS, PERMISOS_BASICOS, normalizar } = require('../lib/permisos');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');

const COLUMNAS = 'id, name, description, permissions, created_at, usuarios(count)';

const aPublico = ({ usuarios, ...r }) => ({ ...r, total_personal: usuarios?.[0]?.count ?? 0 });

function datos(body) {
  if (!Array.isArray(body.permissions)) throw new HttpError(400, 'Permisos: debe ser una lista');
  return {
    name: v.texto(body.name, 'Nombre', { requerido: true, max: 60 }),
    description: v.texto(body.description, 'Descripción', { max: 300 }),
    permissions: normalizar(body.permissions.filter((p) => typeof p === 'string')),
  };
}

function errorRol(error) {
  if (error.code === '23505') return new HttpError(409, 'Ya existe un rol con ese nombre');
  return errorDb(error);
}

// GET /roles  -> roles + catálogo de permisos para armar la matriz
module.exports.listar = handler(async (event) => {
  const admin = await requerirAdminOrg(event);
  const { data, error } = await supabase()
    .from('roles')
    .select(COLUMNAS)
    .eq('organization_id', admin.organization_id)
    .order('name');
  if (error) throw errorDb(error);
  return json(200, {
    roles: data.map(aPublico),
    catalogo: { modulos: MODULOS, acciones: ACCIONES, basicos: PERMISOS_BASICOS },
  });
});

// POST /roles  { name, description?, permissions: [] }
module.exports.crear = handler(async (event) => {
  const admin = await requerirAdminOrg(event);
  const { data, error } = await supabase()
    .from('roles')
    .insert({ ...datos(parseJson(event)), organization_id: admin.organization_id })
    .select(COLUMNAS)
    .single();
  if (error) throw errorRol(error);
  return json(201, { rol: aPublico(data) });
});

// PUT /roles/{id}  (los cambios rigen de inmediato para quienes lo tienen)
module.exports.actualizar = handler(async (event) => {
  const admin = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('roles', id, admin);
  const { data, error } = await supabase()
    .from('roles')
    .update(datos(parseJson(event)))
    .eq('id', id)
    .select(COLUMNAS)
    .single();
  if (error) throw errorRol(error);
  return json(200, { rol: aPublico(data) });
});

// DELETE /roles/{id}  (quienes lo tenían vuelven a los permisos básicos)
module.exports.eliminar = handler(async (event) => {
  const admin = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('roles', id, admin);
  const { error } = await supabase().from('roles').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { ok: true });
});
