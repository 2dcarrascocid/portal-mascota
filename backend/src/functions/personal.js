// Mantenedor de personal de la organización. Escrituras con permisos
// 'personal.*'. El personal no tiene cargo: se crea como STAFF y lo que hace
// sale de sus especialidades. El rol (administrador o rol de permisos) solo
// lo asigna el ORG_ADMIN, y nadie sin ese cargo puede modificar a un ORG_ADMIN.
const { supabase, errorDb } = require('../lib/supabase');
const { ROLES_PERSONAL, requerirPersonal, requerirPermiso, tienePermiso, deLaOrganizacion } = require('../lib/acceso');
const { revocarTodas } = require('../lib/sesiones');
const { enviarInvitacion, avisarIncorporacion } = require('../lib/correos');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');

const COLUMNAS =
  'id, email, first_name, last_name, full_name, rut, phone, avatar_url, role, role_id, activo, ultimo_login, created_at, ' +
  'password_hash, google_sub, facebook_id, rol:roles(name), staff_branches(branch_id), staff_specialties(specialty_id)';

const POR_PAGINA = 20;
const MAX_POR_PAGINA = 100;
const ESTADOS = ['activos', 'pendientes', 'inactivos', 'todos'];

// Nunca se devuelve el hash: solo si la persona ya puede ingresar.
function aPublico({ password_hash: hash, google_sub: google, facebook_id: facebook, rol, staff_branches: sb, staff_specialties: se, ...p }) {
  return {
    ...p,
    rol_nombre: rol?.name ?? null,
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

const esAdmin = (usuario) => usuario.role === 'ORG_ADMIN';

// Quien no es ORG_ADMIN no puede tocar a un ORG_ADMIN (ni, con `propio`,
// sus propias asignaciones: p. ej. darse sucursales).
function protegerObjetivo(actor, objetivo, { propio = false } = {}) {
  if (esAdmin(actor)) return;
  if (objetivo.role === 'ORG_ADMIN') throw new HttpError(403, 'Solo un administrador puede modificar a otro administrador');
  if (propio && objetivo.id === actor.id) throw new HttpError(403, 'No puedes modificar tus propias asignaciones');
}

// Datos personales; full_name se compone para correos, sesión y agendas.
function datosPersona(body) {
  const nombres = v.texto(body.first_name, 'Nombres', { requerido: true, max: 80 });
  const apellidos = v.texto(body.last_name, 'Apellidos', { requerido: true, max: 80 });
  return {
    first_name: nombres,
    last_name: apellidos,
    full_name: `${nombres} ${apellidos}`,
    rut: v.rut(body.rut, 'RUT', { requerido: true }),
    phone: v.texto(body.phone, 'Teléfono', { max: 40 }),
  };
}

// El RUT es único entre todas las cuentas (el índice de la base lo respalda).
async function verificarRut(rut, idPropio) {
  const { data, error } = await supabase().from('usuarios').select('id').eq('rut', rut).maybeSingle();
  if (error) throw errorDb(error);
  if (data && data.id !== idPropio) throw new HttpError(409, 'Ese RUT ya está registrado en otra cuenta');
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

// Las sucursales que se quitan borran sus bloques y excepciones de agenda (cascada).
const guardarSucursales = (staffId, orgId, ids) =>
  reemplazarAsignaciones('staff_branches', 'branch_id', 'Sucursal', staffId, orgId, ids);
const guardarEspecialidades = (staffId, orgId, ids) =>
  reemplazarAsignaciones('staff_specialties', 'specialty_id', 'Especialidad', staffId, orgId, ids);

// Cambio de cargo con las reglas de la base (no a sí mismo, no SUPER_ADMIN...).
async function cambiarRol(actorId, userId, role) {
  const { error } = await supabase().rpc('assign_profile', { p_actor_id: actorId, p_user_id: userId, p_role: role });
  if (error) throw errorDb(error);
}

// Ids del personal con una especialidad o sucursal (para filtrar el listado).
async function idsAsignados(tabla, columna, valor, orgId) {
  const { data, error } = await supabase()
    .from(tabla)
    .select('staff_id')
    .eq(columna, valor)
    .eq('organization_id', orgId);
  if (error) throw errorDb(error);
  return [...new Set(data.map((r) => r.staff_id))];
}

async function contar(orgId, aplicar) {
  const consulta = supabase().from('usuarios').select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
  const { count, error } = await aplicar(consulta);
  if (error) throw errorDb(error);
  return count ?? 0;
}

// Invitación pendiente: aún no tiene forma de ingresar.
const sinAcceso = (c) => c.is('password_hash', null).is('google_sub', null).is('facebook_id', null);

// GET /personal
// Sin `pagina`: lista completa para otras pantallas (agendas, citas). Con
// permiso personal.ver trae todos los miembros (incluye CLIENT); si no, solo
// el personal activo.
// GET /personal?pagina=1&porPagina=20&q=&estado=activos&especialidad=&sucursal=&clientes=1
// -> { personal, total, pagina, porPagina, resumen } (exige personal.ver).
module.exports.listar = handler(async (event) => {
  const q = event.queryStringParameters || {};
  if (q.pagina === undefined) {
    const usuario = await requerirPersonal(event);
    let consulta = supabase()
      .from('usuarios')
      .select(COLUMNAS)
      .eq('organization_id', usuario.organization_id)
      .order('full_name', { nullsFirst: false });
    if (!tienePermiso(usuario, 'personal.ver')) consulta = consulta.in('role', ROLES_PERSONAL).eq('activo', true);
    const { data, error } = await consulta;
    if (error) throw errorDb(error);
    return json(200, { personal: data.map(aPublico) });
  }

  const usuario = await requerirPermiso(event, 'personal.ver');
  const org = usuario.organization_id;
  const pagina = v.entero(q.pagina, 'pagina', { min: 1 });
  const porPagina = v.entero(q.porPagina || POR_PAGINA, 'porPagina', { min: 1, max: MAX_POR_PAGINA });
  const estado = v.opcion(q.estado || 'activos', 'estado', ESTADOS);
  const especialidad = v.uuid(q.especialidad, 'especialidad', { requerido: false });
  const sucursal = v.uuid(q.sucursal, 'sucursal', { requerido: false });
  // Se quitan los caracteres con significado en el filtro de PostgREST.
  const texto = String(q.q || '')
    .replace(/[,()*%\\:"]/g, ' ')
    .trim()
    .slice(0, 60);

  let ids = null;
  if (especialidad) ids = await idsAsignados('staff_specialties', 'specialty_id', especialidad, org);
  if (sucursal) {
    const deSucursal = await idsAsignados('staff_branches', 'branch_id', sucursal, org);
    ids = ids ? ids.filter((id) => deSucursal.includes(id)) : deSucursal;
  }

  const [activos, pendientes, clientes] = await Promise.all([
    contar(org, (c) => c.in('role', ROLES_PERSONAL).eq('activo', true)),
    contar(org, (c) => sinAcceso(c.in('role', ROLES_PERSONAL).eq('activo', true))),
    contar(org, (c) => c.eq('role', 'CLIENT')),
  ]);
  const resumen = { activos, pendientes, clientes };
  if (ids && !ids.length) return json(200, { personal: [], total: 0, pagina, porPagina, resumen });

  const desde = (pagina - 1) * porPagina;
  let consulta = supabase()
    .from('usuarios')
    .select(COLUMNAS, { count: 'exact' })
    .eq('organization_id', org)
    .order('last_name', { nullsFirst: false })
    .order('first_name', { nullsFirst: false })
    .order('full_name', { nullsFirst: false })
    .order('id')
    .range(desde, desde + porPagina - 1);
  if (q.clientes !== '1') consulta = consulta.in('role', ROLES_PERSONAL);
  if (estado === 'activos') consulta = consulta.eq('activo', true);
  if (estado === 'inactivos') consulta = consulta.eq('activo', false);
  if (estado === 'pendientes') consulta = sinAcceso(consulta.eq('activo', true));
  if (ids) consulta = consulta.in('id', ids);
  if (texto) {
    const p = `%${texto}%`;
    // El RUT se guarda sin puntos: '12.345' también debe encontrarlo.
    const r = `%${texto.replace(/\./g, '')}%`;
    consulta = consulta.or(
      `first_name.ilike.${p},last_name.ilike.${p},full_name.ilike.${p},email.ilike.${p},phone.ilike.${p},rut.ilike.${r}`
    );
  }

  const { data, error, count } = await consulta;
  if (error) throw errorDb(error);
  return json(200, { personal: data.map(aPublico), total: count ?? 0, pagina, porPagina, resumen });
});

// POST /personal  { first_name, last_name, rut, email, phone?, specialtyIds?, branchIds? }
// Email nuevo: crea la cuenta y envía invitación para crear contraseña.
// Email existente sin organización: lo suma a la entidad y le avisa.
// Entra con permisos básicos; el rol se asigna aparte (PUT /personal/{id}/rol).
module.exports.crear = handler(async (event) => {
  const actor = await requerirPermiso(event, 'personal.crear');
  const body = parseJson(event);
  const email = v.email(body.email, 'Email');
  if (!email) throw new HttpError(400, 'Email: es obligatorio');
  const datos = { ...datosPersona(body), role: 'STAFF', role_id: null };
  const org = actor.organization_id;
  const db = supabase();

  const { data: existente, error: errorBusqueda } = await db
    .from('usuarios')
    .select('id, organization_id, email, rut')
    .eq('email', email)
    .maybeSingle();
  if (errorBusqueda) throw errorDb(errorBusqueda);
  if (existente?.organization_id === org) throw new HttpError(409, 'Esa persona ya es parte de tu entidad');
  if (existente?.organization_id) throw new HttpError(409, 'Ese email pertenece a otra entidad');
  if (existente?.rut && existente.rut !== datos.rut) throw new HttpError(409, 'Esa cuenta ya tiene registrado otro RUT');
  await verificarRut(datos.rut, existente?.id);

  let id;
  let nueva = false;
  if (existente) {
    // Ya tenía cuenta propia: se suma a la entidad conservando su contraseña.
    const { error } = await db
      .from('usuarios')
      .update({ ...datos, organization_id: org })
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
    else await avisarIncorporacion({ email, full_name: datos.full_name }, organizacion);
  } catch (err) {
    console.error('No se pudo enviar el correo al nuevo integrante', err);
    correoEnviado = false;
  }

  return json(201, { integrante: await obtener(id), correoEnviado, cuentaExistente: !nueva });
});

// PUT /personal/{id}  { first_name, last_name, rut, phone, specialtyIds? }
module.exports.actualizar = handler(async (event) => {
  const actor = await requerirPermiso(event, 'personal.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const actual = await deLaOrganizacion('usuarios', id, actor, 'id, role');
  protegerObjetivo(actor, actual);
  if (!ROLES_PERSONAL.includes(actual.role)) throw new HttpError(400, 'Primero asígnale un rol de personal');
  const body = parseJson(event);
  const cambios = datosPersona(body);
  await verificarRut(cambios.rut, id);

  const { error } = await supabase().from('usuarios').update(cambios).eq('id', id);
  if (error) throw errorDb(error);
  if (body.specialtyIds !== undefined) await guardarEspecialidades(id, actor.organization_id, body.specialtyIds);

  return json(200, { integrante: await obtener(id) });
});

// PUT /personal/{id}/rol  { administrador: boolean, role_id?: uuid | null }
// Solo el ORG_ADMIN. administrador = acceso total; si no, rol de permisos
// (null = permisos básicos). Un cliente al que se le asigna rol pasa a ser personal.
module.exports.asignarRol = handler(async (event) => {
  const actor = await requerirPermiso(event, 'personal.editar');
  if (!esAdmin(actor)) throw new HttpError(403, 'Solo un administrador puede asignar roles');
  const id = v.uuid(event.pathParameters.id, 'id');
  if (id === actor.id) throw new HttpError(400, 'No puedes cambiar tu propio rol');
  const actual = await deLaOrganizacion('usuarios', id, actor, 'id, role');
  if (actual.role === 'SUPER_ADMIN') throw new HttpError(403, 'No autorizado');
  const body = parseJson(event);
  const administrador = body.administrador === true;
  const cargo = administrador ? 'ORG_ADMIN' : ['ORG_ADMIN', 'CLIENT'].includes(actual.role) ? 'STAFF' : actual.role;
  const roleId = administrador ? null : v.uuid(body.role_id, 'Rol', { requerido: false });

  // Primero el rol de permisos: la FK compuesta rechaza roles de otra organización.
  const { error } = await supabase().from('usuarios').update({ role_id: roleId }).eq('id', id);
  if (error) throw errorDb(error);
  if (cargo !== actual.role) await cambiarRol(actor.id, id, cargo);

  return json(200, { integrante: await obtener(id) });
});

// PUT /personal/{id}/sucursales  { branchIds: [] }
module.exports.asignarSucursales = handler(async (event) => {
  const actor = await requerirPermiso(event, 'personal.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const miembro = await deLaOrganizacion('usuarios', id, actor, 'id, role');
  protegerObjetivo(actor, miembro, { propio: true });
  if (!ROLES_PERSONAL.includes(miembro.role)) throw new HttpError(400, 'Primero asígnale un rol de personal');
  const ids = await guardarSucursales(id, actor.organization_id, parseJson(event).branchIds);
  return json(200, { branch_ids: ids });
});

// PUT /personal/{id}/estado  { activo }
// Desactivar corta el acceso de inmediato y cierra sus sesiones.
module.exports.cambiarEstado = handler(async (event) => {
  const actor = await requerirPermiso(event, 'personal.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  if (id === actor.id) throw new HttpError(400, 'No puedes desactivar tu propia cuenta');
  protegerObjetivo(actor, await deLaOrganizacion('usuarios', id, actor, 'id, role'));
  const { activo } = parseJson(event);
  if (typeof activo !== 'boolean') throw new HttpError(400, 'activo debe ser true o false');

  const { error } = await supabase().from('usuarios').update({ activo }).eq('id', id);
  if (error) throw errorDb(error);
  if (!activo) await revocarTodas(id);
  return json(200, { integrante: await obtener(id) });
});

// POST /personal/{id}/invitacion  -> reenvía el correo para crear contraseña
module.exports.reenviarInvitacion = handler(async (event) => {
  const actor = await requerirPermiso(event, 'personal.crear');
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('usuarios', id, actor);
  const integrante = await obtener(id);
  if (!integrante.invitacion_pendiente) throw new HttpError(400, 'Esta persona ya puede ingresar; no necesita invitación');
  if (!integrante.activo) throw new HttpError(400, 'La cuenta está desactivada');

  try {
    await enviarInvitacion(integrante, await nombreOrganizacion(actor.organization_id));
  } catch (err) {
    console.error('Reenvío de invitación falló', err);
    throw new HttpError(502, 'No se pudo enviar el correo. Revisa la configuración SMTP.');
  }
  return json(200, { ok: true });
});

// DELETE /personal/{id}  -> la quita de la entidad (la cuenta sigue existiendo)
module.exports.quitar = handler(async (event) => {
  const actor = await requerirPermiso(event, 'personal.eliminar');
  const id = v.uuid(event.pathParameters.id, 'id');
  if (id === actor.id) throw new HttpError(400, 'No puedes quitarte a ti mismo de la entidad');
  const miembro = await deLaOrganizacion('usuarios', id, actor, 'id, role');
  if (miembro.role === 'SUPER_ADMIN') throw new HttpError(403, 'No autorizado');
  protegerObjetivo(actor, miembro);

  // Primero sus sucursales (y agendas, en cascada), especialidades y
  // excepciones de agenda: las FKs compuestas impiden cambiarle la
  // organización mientras tenga asignaciones.
  const db = supabase();
  for (const tabla of ['staff_branches', 'staff_specialties', 'schedule_exceptions']) {
    const { error: errorAsignaciones } = await db.from(tabla).delete().eq('staff_id', id);
    if (errorAsignaciones) throw errorDb(errorAsignaciones);
  }

  const { error } = await db
    .from('usuarios')
    .update({ organization_id: null, role: 'CLIENT', role_id: null })
    .eq('id', id)
    .eq('organization_id', actor.organization_id);
  if (error) throw errorDb(error);

  await revocarTodas(id);
  return json(200, { ok: true });
});
