const { supabase } = require('./supabase');
const { verificarAcceso } = require('./sesiones');
const { HttpError, header } = require('./http');

function tokenBearer(event) {
  const auth = header(event, 'authorization') || '';
  const [tipo, token] = auth.split(' ');
  if (tipo !== 'Bearer' || !token) throw new HttpError(401, 'Token requerido');
  return token;
}

// Valida el access token propio (header Authorization) y devuelve
// { id, email, role, organization_id } o lanza 401/403.
// Se consulta la base en cada petición para que desactivar a un usuario o
// cambiarle el rol tenga efecto inmediato.
async function requerirUsuario(event) {
  const id = verificarAcceso(tokenBearer(event));

  const { data: usuario, error } = await supabase()
    .from('usuarios')
    .select('id, email, role, organization_id, activo')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!usuario) throw new HttpError(401, 'Usuario no encontrado');
  if (!usuario.activo) throw new HttpError(403, 'Usuario desactivado');

  const { activo, ...resto } = usuario;
  return resto;
}

async function requerirRol(event, ...roles) {
  const usuario = await requerirUsuario(event);
  if (!roles.includes(usuario.role)) throw new HttpError(403, 'No autorizado');
  return usuario;
}

module.exports = { tokenBearer, requerirUsuario, requerirRol };
