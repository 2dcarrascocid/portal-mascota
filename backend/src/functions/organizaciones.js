const { supabase, errorDb } = require('../lib/supabase');
const { requerirUsuario } = require('../lib/auth');
const { HttpError, json, parseJson, handler } = require('../lib/http');
const { datosUsuario } = require('./auth');

const TIPOS = ['PRIVATE_COMPANY', 'MUNICIPALITY', 'INDEPENDENT'];
const ROLES = ['SUPER_ADMIN', 'ORG_ADMIN', 'STAFF', 'VET', 'GROOMER', 'TRAINER', 'CLIENT'];

// Las reglas de autorización están en las RPC (migración 0002); aquí se les
// pasa el usuario autenticado como p_actor_id.
async function rpc(nombre, params) {
  const { data, error } = await supabase().rpc(nombre, params);
  if (error) throw errorDb(error);
  return data;
}

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// GET /organizaciones/publicas  (sin sesión: lo usa el formulario de registro)
module.exports.publicas = handler(async () => {
  return json(200, { organizaciones: await rpc('list_public_organizations') });
});

// POST /organizaciones/unirse  { organizationId }  -> { usuario, perfil, organizacion }
module.exports.unirse = handler(async (event) => {
  const usuario = await requerirUsuario(event);
  const { organizationId } = parseJson(event);
  if (!organizationId) throw new HttpError(400, 'Falta organizationId');

  await rpc('join_organization', { p_actor_id: usuario.id, p_organization_id: organizationId });
  return json(200, await datosUsuario(usuario));
});

// POST /organizaciones  { name, type, taxId?, address?, phone?, email? }
// -> { usuario, perfil, organizacion }  (quien la crea queda como ORG_ADMIN)
module.exports.crear = handler(async (event) => {
  const usuario = await requerirUsuario(event);
  const { name, type, taxId, address, phone, email } = parseJson(event);
  if (!texto(name)) throw new HttpError(400, 'Falta el nombre');
  if (!TIPOS.includes(type)) throw new HttpError(400, 'Tipo de organización inválido');

  await rpc('create_organization', {
    p_actor_id: usuario.id,
    p_name: name,
    p_type: type,
    p_tax_id: texto(taxId),
    p_address: texto(address),
    p_phone: texto(phone),
    p_email: texto(email),
  });
  return json(201, await datosUsuario(usuario));
});

// POST /perfiles/asignar  { userId, role, organizationId? }  -> { perfil }
// ORG_ADMIN: roles dentro de su organización. SUPER_ADMIN: además, la organización.
module.exports.asignar = handler(async (event) => {
  const usuario = await requerirUsuario(event);
  const { userId, role, organizationId } = parseJson(event);
  if (!userId) throw new HttpError(400, 'Falta userId');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Rol inválido');

  const perfil = await rpc('assign_profile', {
    p_actor_id: usuario.id,
    p_user_id: userId,
    p_role: role,
    p_organization_id: organizationId || null,
  });
  return json(200, { perfil });
});
