// Mantenedor de personal de la organización (solo ORG_ADMIN, salvo el listado).
const { supabase, errorDb } = require('../lib/supabase');
const { ROLES_PERSONAL, requerirPersonal, requerirAdminOrg, deLaOrganizacion } = require('../lib/acceso');
const { revocarTodas } = require('../lib/sesiones');
const { enviarInvitacion, avisarIncorporacion } = require('../lib/correos');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');

const COLUMNAS =
  'id, email, full_name, phone, avatar_url, role, activo, ultimo_login, created_at, ' +
  'password_hash, google_sub, facebook_id, staff_branches(branch_id), staff_specialties(specialty_id)';

// Nunca se devuelve el hash: solo si la persona ya puede ingresar.
function aPublico({ password_hash: hash, google_sub: google, facebook_id: facebook, staff_branches: sb, staff_specialties: se, ...p }) {
  return {
    ...p,
    invitacion_pendiente: !hash && !google && !facebook,
    branch_ids: (sb || []).map((a) => a.branch_id),
    specialty_ids: (se || []).map((a) => a.specialty_id),
  };
}

async function obtener(id) {
  const { data, error } = await supabase().from('usuarios').select(COLUMNAS).eq('id', id).single();
  if (error) throw errorDb(error);
  return aPublico(data);
}

async function nombreOrganizacion(orgId) {
  const { data } = await supabase().from('organizations').select('name').eq('id', orgId).single();
  return data?.name ?? 'tu organización';
}

// Reemplaza las asignaciones de una persona en una tabla N a N (sucursales o
// especialidades). Las FKs compuestas rechazan ids de otra organización.
async function reemplazarAsignaciones(tabla, columna, etiqueta, staffId, orgId, lista) {
  if (!Array.isArray(lista)) throw new HttpError(400, `${etiqueta}: debe ser una lista`);
  const ids = [...new Set(lista.map((x) => v.uuid(x, etiqueta)))];
  const db = supabase();

  let quitar = db.from(tabla).delete().eq('staff_id', staffId);
  if (ids.length) quitar = quitar.not(columna, 'in', `(${ids.join(',')})`);
  const { error: errorQuitar } = await quitar;
  if (errorQuitar) throw errorDb(errorQuitar);

  if (ids.length) {
    const { error } = await db
      .from(tabla)
      .upsert(
        ids.map((id) => ({ staff_id: staffId, [columna]: id, organization_id: orgId })),
        { onConflict: `staff_id,${columna}`, ignoreDuplicates: true }
      );
    if (error) throw errorDb(error);
  }
  return ids;
}

// Las sucursales que se quitan borran sus bloques de agenda (cascada).
const guardarSucursales = (staffId, orgId, ids) =>
  reemplazarAsignaciones('staff_branches', 'branch_id', 'Sucursal', staffId, orgId, ids);
const guardarEspecialidades = (staffId, orgId, ids) =>
  reemplazarAsignaciones('staff_specialties', 'specialty_id', 'Especialidad', staffId, orgId, ids);

// Cambio de rol con las reglas de la base (no a sí mismo, no SUPER_ADMIN...).
async function cambiarRol(actorId, userId, role) {
  const { error } = await supabase().rpc('assign_profile', { p_actor_id: actorId, p_user_id: userId, p_role: role });
  if (error) throw errorDb(error);
}

// GET /personal
// Admin: todos los miembros (incluye CLIENT). Especialista: solo el personal.
module.exports.listar = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  let consulta = supabase()
    .from('usuarios')
    .select(COLUMNAS)
    .eq('organization_id', usuario.organization_id)
    .order('full_name', { nullsFirst: false });
  if (usuario.role !== 'ORG_ADMIN') consulta = consulta.in('role', ROLES_PERSONAL).eq('activo', true);

  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  return json(200, { personal: data.map(aPublico) });
});

// POST /personal  { email, full_name, phone?, role, specialtyIds?, branchIds? }
// Email nuevo: crea la cuenta y envía invitación para crear contraseña.
// Email existente sin organización: lo suma a la entidad y le avisa.
module.exports.crear = handler(async (event) => {
  const admin = await requerirAdminOrg(event);
  const body = parseJson(event);
  const email = v.email(body.email, 'Email');
  if (!email) throw new HttpError(400, 'Email: es obligatorio');
  const datos = {
    full_name: v.texto(body.full_name, 'Nombre', { requerido: true, max: 120 }),
    phone: v.texto(body.phone, 'Teléfono', { max: 40 }),
    role: v.opcion(body.role, 'Rol', ROLES_PERSONAL),
  };
  const org = admin.organization_id;
  const db = supabase();

  const { data: existente, error: errorBusqueda } = await db
    .from('usuarios')
    .select('id, organization_id, full_name, email')
    .eq('email', email)
    .maybeSingle();
  if (errorBusqueda) throw errorDb(errorBusqueda);
  if (existente?.organization_id === org) throw new HttpError(409, 'Esa persona ya es parte de tu entidad');
  if (existente?.organization_id) throw new HttpError(409, 'Ese email pertenece a otra entidad');

  let id;
  let nueva = false;
  if (existente) {
    // Ya tenía cuenta propia: se suma a la entidad conservando su contraseña.
    const { error } = await db
      .from('usuarios')
      .update({ ...datos, full_name: existente.full_name || datos.full_name, organization_id: org })
      .eq('id', existente.id)
      .is('organization_id', null);
    if (error) throw errorDb(error);
    id = existente.id;
  } else {
    const { data, error } = await db
      .from('usuarios')
      .insert({ ...datos, email, organization_id: org })
      .select('id')
      .single();
    if (error) throw errorDb(error);
    id = data.id;
    nueva = true;
  }

  if (body.branchIds?.length) await guardarSucursales(id, org, body.branchIds);
  if (body.specialtyIds?.length) await guardarEspecialidades(id, org, body.specialtyIds);

  const organizacion = await nombreOrganizacion(org);
  let correoEnviado = true;
  try {
    if (nueva) await enviarInvitacion({ id, email, full_name: datos.full_name }, organizacion);
    else await avisarIncorporacion({ email, full_name: existente.full_name || datos.full_name }, organizacion);
  } catch (err) {
    console.error('No se pudo enviar el correo al nuevo integrante', err);
    correoEnviado = false;
  }

  return json(201, { integrante: await obtener(id), correoEnviado, cuentaExistente: !nueva });
});

// PUT /personal/{id}  { full_name, phone, role, specialtyIds? }
module.exports.actualizar = handler(async (event) => {
  const admin = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  const actual = await deLaOrganizacion('usuarios', id, admin, 'id, role');
  const body = parseJson(event);
  const cambiaRol = body.role && body.role !== actual.role;
  // Se valida antes de guardar nada, para no dejar cambios a medias.
  if (cambiaRol && id === admin.id) throw new HttpError(400, 'No puedes cambiar tu propio rol');
  const nuevoRol = cambiaRol ? v.opcion(body.role, 'Rol', [...ROLES_PERSONAL, 'CLIENT']) : null;

  const { error } = await supabase()
    .from('usuarios')
    .update({
      full_name: v.texto(body.full_name, 'Nombre', { requerido: true, max: 120 }),
      phone: v.texto(body.phone, 'Teléfono', { max: 40 }),
    })
    .eq('id', id);
  if (error) throw errorDb(error);

  if (nuevoRol) await cambiarRol(admin.id, id, nuevoRol);
  // Un cliente no tiene especialidades.
  if ((nuevoRol || actual.role) === 'CLIENT') await guardarEspecialidades(id, admin.organization_id, []);
  else if (body.specialtyIds !== undefined) await guardarEspecialidades(id, admin.organization_id, body.specialtyIds);

  return json(200, { integrante: await obtener(id) });
});

// PUT /personal/{id}/sucursales  { branchIds: [] }
module.exports.asignarSucursales = handler(async (event) => {
  const admin = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  const miembro = await deLaOrganizacion('usuarios', id, admin, 'id, role');
  if (!ROLES_PERSONAL.includes(miembro.role)) {
    throw new HttpError(400, 'Primero asígnale un rol de personal (veterinario, peluquero, adiestrador o admin)');
  }
  const ids = await guardarSucursales(id, admin.organization_id, parseJson(event).branchIds);
  return json(200, { branch_ids: ids });
});

// PUT /personal/{id}/estado  { activo }
// Desactivar corta el acceso de inmediato y cierra sus sesiones.
module.exports.cambiarEstado = handler(async (event) => {
  const admin = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  if (id === admin.id) throw new HttpError(400, 'No puedes desactivar tu propia cuenta');
  await deLaOrganizacion('usuarios', id, admin);
  const { activo } = parseJson(event);
  if (typeof activo !== 'boolean') throw new HttpError(400, 'activo debe ser true o false');

  const { error } = await supabase().from('usuarios').update({ activo }).eq('id', id);
  if (error) throw errorDb(error);
  if (!activo) await revocarTodas(id);
  return json(200, { integrante: await obtener(id) });
});

// POST /personal/{id}/invitacion  -> reenvía el correo para crear contraseña
module.exports.reenviarInvitacion = handler(async (event) => {
  const admin = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('usuarios', id, admin);
  const integrante = await obtener(id);
  if (!integrante.invitacion_pendiente) throw new HttpError(400, 'Esta persona ya puede ingresar; no necesita invitación');
  if (!integrante.activo) throw new HttpError(400, 'La cuenta está desactivada');

  try {
    await enviarInvitacion(integrante, await nombreOrganizacion(admin.organization_id));
  } catch (err) {
    console.error('Reenvío de invitación falló', err);
    throw new HttpError(502, 'No se pudo enviar el correo. Revisa la configuración SMTP.');
  }
  return json(200, { ok: true });
});

// DELETE /personal/{id}  -> la quita de la entidad (la cuenta sigue existiendo)
module.exports.quitar = handler(async (event) => {
  const admin = await requerirAdminOrg(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  if (id === admin.id) throw new HttpError(400, 'No puedes quitarte a ti mismo de la entidad');
  const miembro = await deLaOrganizacion('usuarios', id, admin, 'id, role');
  if (miembro.role === 'SUPER_ADMIN') throw new HttpError(403, 'No autorizado');

  // Primero sus sucursales (y agendas, en cascada) y especialidades: las FKs
  // compuestas impiden cambiarle la organización mientras tenga asignaciones.
  const db = supabase();
  for (const tabla of ['staff_branches', 'staff_specialties']) {
    const { error: errorAsignaciones } = await db.from(tabla).delete().eq('staff_id', id);
    if (errorAsignaciones) throw errorDb(errorAsignaciones);
  }

  const { error } = await db
    .from('usuarios')
    .update({ organization_id: null, role: 'CLIENT' })
    .eq('id', id)
    .eq('organization_id', admin.organization_id);
  if (error) throw errorDb(error);

  await revocarTodas(id);
  return json(200, { ok: true });
});
