// Sesiones propias: access token JWT de vida corta + refresh token opaco
// (en la base solo se guarda su hash) que se rota en cada renovación.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { supabase } = require('./supabase');
const { HttpError } = require('./http');

const sha256 = (valor) => crypto.createHash('sha256').update(valor).digest('hex');
const tokenAleatorio = () => crypto.randomBytes(32).toString('base64url');

function firmarAcceso(usuarioId) {
  const { secret, expiresIn } = config.jwt();
  return jwt.sign({}, secret, { subject: usuarioId, expiresIn, audience: 'portal-canino' });
}

// Devuelve el id del usuario del access token o lanza 401.
function verificarAcceso(token) {
  try {
    return jwt.verify(token, config.jwt().secret, { audience: 'portal-canino' }).sub;
  } catch {
    throw new HttpError(401, 'Token inválido o expirado');
  }
}

async function emitir(usuarioId, userAgent) {
  const refresh = tokenAleatorio();
  const expira = new Date(Date.now() + config.diasSesion() * 86_400_000);
  const { error } = await supabase().from('sesiones').insert({
    usuario_id: usuarioId,
    refresh_token_hash: sha256(refresh),
    expira_at: expira.toISOString(),
    user_agent: userAgent?.slice(0, 300) ?? null,
  });
  if (error) throw error;

  const access = firmarAcceso(usuarioId);
  return { access_token: access, refresh_token: refresh, expires_at: jwt.decode(access).exp };
}

// Nueva sesión tras un ingreso exitoso.
async function crearSesion(usuarioId, userAgent) {
  const { error } = await supabase()
    .from('usuarios')
    .update({ ultimo_login: new Date().toISOString(), intentos_fallidos: 0, bloqueado_hasta: null })
    .eq('id', usuarioId);
  if (error) throw error;
  return emitir(usuarioId, userAgent);
}

// Canjea un refresh token por uno nuevo (el anterior queda revocado).
async function renovarSesion(refreshToken, userAgent) {
  const ahora = new Date().toISOString();
  // La condición revocada_at is null hace el canje atómico: dos renovaciones
  // simultáneas con el mismo token no pueden ganar ambas.
  const { data, error } = await supabase()
    .from('sesiones')
    .update({ revocada_at: ahora })
    .eq('refresh_token_hash', sha256(refreshToken))
    .is('revocada_at', null)
    .gt('expira_at', ahora)
    .select('usuario_id, usuarios(activo)')
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.usuarios?.activo) throw new HttpError(401, 'Sesión expirada');

  return emitir(data.usuario_id, userAgent);
}

async function revocarSesion(refreshToken) {
  const { error } = await supabase()
    .from('sesiones')
    .update({ revocada_at: new Date().toISOString() })
    .eq('refresh_token_hash', sha256(refreshToken))
    .is('revocada_at', null);
  if (error) throw error;
}

// Al cambiar la contraseña se cierran todas las sesiones del usuario.
async function revocarTodas(usuarioId) {
  const { error } = await supabase()
    .from('sesiones')
    .update({ revocada_at: new Date().toISOString() })
    .eq('usuario_id', usuarioId)
    .is('revocada_at', null);
  if (error) throw error;
}

module.exports = { sha256, tokenAleatorio, verificarAcceso, crearSesion, renovarSesion, revocarSesion, revocarTodas };
