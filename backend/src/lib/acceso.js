// Reglas de acceso del módulo de estructura/catálogos/tutores.
// Todo se aísla por organization_id del usuario autenticado; el personal
// que no es ORG_ADMIN además queda limitado a sus sucursales asignadas.
const { supabase } = require('./supabase');
const { requerirUsuario } = require('./auth');
const { HttpError } = require('./http');

const ROLES_PERSONAL = ['ORG_ADMIN', 'VET', 'GROOMER', 'TRAINER'];

// Personal de una organización (admin o especialista).
async function requerirPersonal(event) {
  const usuario = await requerirUsuario(event);
  if (!usuario.organization_id) throw new HttpError(403, 'Tu cuenta no pertenece a una organización');
  if (!ROLES_PERSONAL.includes(usuario.role)) throw new HttpError(403, 'No autorizado');
  return usuario;
}

async function requerirAdminOrg(event) {
  const usuario = await requerirPersonal(event);
  if (usuario.role !== 'ORG_ADMIN') throw new HttpError(403, 'Solo el administrador de la organización puede hacer esto');
  return usuario;
}

// null = sin restricción (admin); si no, ids de sus sucursales asignadas.
async function sucursalesDe(usuario) {
  if (usuario.role === 'ORG_ADMIN') return null;
  const { data, error } = await supabase().from('staff_branches').select('branch_id').eq('staff_id', usuario.id);
  if (error) throw error;
  return data.map((r) => r.branch_id);
}

// Verifica que la fila (por id) pertenezca a la organización del usuario.
async function deLaOrganizacion(tabla, id, usuario, columnas = 'id') {
  const { data, error } = await supabase()
    .from(tabla)
    .select(columnas)
    .eq('id', id)
    .eq('organization_id', usuario.organization_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'No encontrado');
  return data;
}

module.exports = { ROLES_PERSONAL, requerirPersonal, requerirAdminOrg, sucursalesDe, deLaOrganizacion };
