const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../lib/config');
const { supabase } = require('../lib/supabase');
const { requerirUsuario } = require('../lib/auth');
const { hashPassword, verificarPassword, verificarRelleno } = require('../lib/passwords');
const sesiones = require('../lib/sesiones');
const { proveedor } = require('../lib/oauth');
const { enviarVerificacion, enviarRecuperacion } = require('../lib/correos');
const { HttpError, json, redirect, cookie, parseJson, header, handler } = require('../lib/http');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;

const COLUMNAS_PERFIL =
  'id, email, full_name, avatar_url, phone, role, organization_id, email_verificado_at, created_at';

// Solo rutas internas del frontend: evita redirecciones abiertas.
const rutaInterna = (valor) =>
  typeof valor === 'string' && valor.startsWith('/') && !valor.startsWith('//') ? valor : '';

const userAgent = (event) => header(event, 'user-agent');

function leerEmail(valor) {
  const email = typeof valor === 'string' ? valor.trim().toLowerCase() : '';
  if (!EMAIL.test(email)) throw new HttpError(400, 'Email inválido');
  return email;
}

function leerPasswordNueva(valor) {
  if (typeof valor !== 'string' || valor.length < 8) {
    throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
  }
  if (valor.length > 200) throw new HttpError(400, 'La contraseña es demasiado larga');
  return valor;
}

async function buscarPorEmail(email) {
  const { data, error } = await supabase().from('usuarios').select('*').eq('email', email).maybeSingle();
  if (error) throw error;
  return data;
}

// { usuario, perfil, organizacion } del usuario indicado.
async function datosUsuario({ id }) {
  const { data, error } = await supabase()
    .from('usuarios')
    .select(`${COLUMNAS_PERFIL}, organization:organizations(*)`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(401, 'Usuario no encontrado');

  const { organization, ...perfil } = data;
  return { usuario: { id: data.id, email: data.email }, perfil, organizacion: organization };
}

async function respuestaSesion(statusCode, usuarioId, event) {
  const sesion = await sesiones.crearSesion(usuarioId, userAgent(event));
  return json(statusCode, { sesion, ...(await datosUsuario({ id: usuarioId })) });
}

// ── Tokens por correo (verificación y recuperación) ──────────

// Marca el token como usado y devuelve el usuario; un solo uso, con vencimiento.
async function consumirTokenCorreo(token, tipo) {
  if (typeof token !== 'string' || !token) throw new HttpError(400, 'Falta el token');
  const ahora = new Date().toISOString();
  const { data, error } = await supabase()
    .from('tokens_usuario')
    .update({ usado_at: ahora })
    .eq('token_hash', sesiones.sha256(token))
    .eq('tipo', tipo)
    .is('usado_at', null)
    .gt('expira_at', ahora)
    .select('usuario_id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(400, 'El enlace expiró o ya fue usado');
  return data.usuario_id;
}

// ── Email + contraseña ───────────────────────────────────────

// POST /auth/registro  { email, password, fullName, organizationId? }  -> { requiereConfirmacion }
module.exports.registro = handler(async (event) => {
  const body = parseJson(event);
  const email = leerEmail(body.email);
  const password = leerPasswordNueva(body.password);
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 120) || null : null;

  if (await buscarPorEmail(email)) {
    throw new HttpError(409, 'Ya existe una cuenta con ese email. Ingresa o recupera tu contraseña.');
  }

  // Link de registro de una entidad (?org=): solo si admite registro público.
  let organizationId = null;
  if (UUID.test(body.organizationId || '')) {
    const { data } = await supabase()
      .from('organizations')
      .select('id')
      .eq('id', body.organizationId)
      .eq('settings->>public_signup', 'true')
      .maybeSingle();
    organizationId = data?.id ?? null;
  }

  const { data: usuario, error } = await supabase()
    .from('usuarios')
    .insert({ email, password_hash: await hashPassword(password), full_name: fullName, organization_id: organizationId })
    .select('id, email, full_name')
    .single();
  if (error?.code === '23505') throw new HttpError(409, 'Ya existe una cuenta con ese email.');
  if (error) throw error;

  try {
    await enviarVerificacion(usuario);
  } catch (err) {
    console.error('No se pudo enviar el correo de verificación', err);
    throw new HttpError(502, 'Cuenta creada, pero no se pudo enviar el correo de confirmación. Usa "Reenviar correo".');
  }
  return json(201, { requiereConfirmacion: true });
});

// POST /auth/login  { email, password }  -> { sesion, usuario, perfil, organizacion }
module.exports.login = handler(async (event) => {
  const body = parseJson(event);
  const email = leerEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  const usuario = await buscarPorEmail(email);
  if (!usuario || !usuario.password_hash) {
    await verificarRelleno(password);
    if (usuario) throw new HttpError(401, 'Esta cuenta aún no tiene contraseña: usa el enlace de tu invitación, ingresa con Google o usa "¿Olvidaste tu contraseña?".');
    throw new HttpError(401, 'Email o contraseña incorrectos');
  }

  if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
    const minutos = Math.ceil((new Date(usuario.bloqueado_hasta) - Date.now()) / 60_000);
    throw new HttpError(429, `Demasiados intentos fallidos. Intenta de nuevo en ${minutos} min.`);
  }

  if (!(await verificarPassword(password, usuario.password_hash))) {
    const intentos = usuario.intentos_fallidos + 1;
    const bloquear = intentos >= MAX_INTENTOS;
    await supabase()
      .from('usuarios')
      .update({
        intentos_fallidos: bloquear ? 0 : intentos,
        bloqueado_hasta: bloquear ? new Date(Date.now() + MINUTOS_BLOQUEO * 60_000).toISOString() : null,
      })
      .eq('id', usuario.id);
    throw new HttpError(401, 'Email o contraseña incorrectos');
  }

  if (!usuario.activo) throw new HttpError(403, 'Usuario desactivado');
  if (!usuario.email_verificado_at) {
    throw new HttpError(403, 'Debes confirmar tu email antes de ingresar. Revisa tu correo.');
  }
  return respuestaSesion(200, usuario.id, event);
});

// POST /auth/verificar  { token }  -> confirma el email e inicia sesión
module.exports.verificar = handler(async (event) => {
  const usuarioId = await consumirTokenCorreo(parseJson(event).token, 'verificar_email');
  const { error } = await supabase()
    .from('usuarios')
    .update({ email_verificado_at: new Date().toISOString() })
    .eq('id', usuarioId)
    .is('email_verificado_at', null);
  if (error) throw error;
  return respuestaSesion(200, usuarioId, event);
});

// POST /auth/reenviar-verificacion  { email }
// Respuesta siempre igual: no revela si el email existe.
module.exports.reenviarVerificacion = handler(async (event) => {
  const usuario = await buscarPorEmail(leerEmail(parseJson(event).email));
  if (usuario && usuario.activo && !usuario.email_verificado_at) {
    await enviarVerificacion(usuario).catch((err) => console.error('Reenvío de verificación falló', err));
  }
  return json(200, { mensaje: 'Si la cuenta existe y no está confirmada, te enviamos un correo.' });
});

// POST /auth/recuperar  { email }
// Respuesta siempre igual: no revela si el email existe.
module.exports.recuperar = handler(async (event) => {
  const usuario = await buscarPorEmail(leerEmail(parseJson(event).email));
  if (usuario && usuario.activo) {
    await enviarRecuperacion(usuario).catch((err) => console.error('Correo de recuperación falló', err));
  }
  return json(200, { mensaje: 'Si existe una cuenta con ese email, te enviamos un enlace para restablecer la contraseña.' });
});

// POST /auth/restablecer  { token, password }  -> nueva contraseña e inicia sesión
module.exports.restablecer = handler(async (event) => {
  const body = parseJson(event);
  const password = leerPasswordNueva(body.password);
  const usuarioId = await consumirTokenCorreo(body.token, 'restablecer_password');

  const { data: usuario, error } = await supabase()
    .from('usuarios')
    .select('activo, email_verificado_at')
    .eq('id', usuarioId)
    .single();
  if (error) throw error;
  if (!usuario.activo) throw new HttpError(403, 'Usuario desactivado');

  // Abrir el enlace del correo también demuestra que el email es suyo.
  const { error: errorUpdate } = await supabase()
    .from('usuarios')
    .update({
      password_hash: await hashPassword(password),
      email_verificado_at: usuario.email_verificado_at ?? new Date().toISOString(),
      intentos_fallidos: 0,
      bloqueado_hasta: null,
    })
    .eq('id', usuarioId);
  if (errorUpdate) throw errorUpdate;

  await sesiones.revocarTodas(usuarioId);
  return respuestaSesion(200, usuarioId, event);
});

// ── Sesión ───────────────────────────────────────────────────

// POST /auth/refresh  { refresh_token }  -> { sesion }
module.exports.refresh = handler(async (event) => {
  const { refresh_token: refreshToken } = parseJson(event);
  if (typeof refreshToken !== 'string' || !refreshToken) throw new HttpError(400, 'Falta refresh_token');
  return json(200, { sesion: await sesiones.renovarSesion(refreshToken, userAgent(event)) });
});

// POST /auth/logout  { refresh_token }  -> revoca esa sesión
module.exports.logout = handler(async (event) => {
  const { refresh_token: refreshToken } = parseJson(event);
  if (typeof refreshToken === 'string' && refreshToken) await sesiones.revocarSesion(refreshToken);
  return json(200, { ok: true });
});

// GET /auth/me  -> { usuario, perfil, organizacion }
module.exports.me = handler(async (event) => {
  const usuario = await requerirUsuario(event);
  return json(200, await datosUsuario(usuario));
});

// ── Google / Facebook ────────────────────────────────────────

const COOKIE_OAUTH = 'pc_oauth';

// URL pública del backend (para el redirect_uri registrado en Google/Facebook).
function urlBackend(event) {
  const host = header(event, 'host') || event.requestContext.domainName;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = header(event, 'x-forwarded-proto') || (local ? 'http' : 'https');
  return `${proto}://${host}`;
}

function cookieOauth(valor, event, maxAge) {
  const segura = urlBackend(event).startsWith('https') ? '; Secure' : '';
  return `${COOKIE_OAUTH}=${valor}; Path=/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${segura}`;
}

// Vuelve al frontend con la sesión (o el error) en el fragmento (#), que el
// navegador no envía a ningún servidor.
function volverAlFrontend(datos, destino, event) {
  const url = new URL(`${config.frontendUrl()}/auth/callback`);
  const ruta = rutaInterna(destino);
  if (ruta) url.searchParams.set('redirect', ruta);
  url.hash = new URLSearchParams(datos).toString();
  return redirect(url.toString(), [cookieOauth('', event, 0)]);
}

// GET /auth/oauth/{google|facebook}?redirect=/ruta
function iniciarOauth(nombre) {
  return handler(async (event) => {
    let p;
    try {
      p = proveedor(nombre);
    } catch (err) {
      // El usuario llegó navegando: se vuelve al frontend con el mensaje.
      return volverAlFrontend({ error_description: err.message }, '', event);
    }
    const nonce = crypto.randomBytes(16).toString('base64url');
    // `state` firmado: protege contra CSRF (debe coincidir con la cookie) y
    // lleva la ruta a la que volver.
    const state = jwt.sign(
      { n: nonce, r: rutaInterna((event.queryStringParameters || {}).redirect), p: nombre },
      config.jwt().secret,
      { expiresIn: '10m', audience: 'oauth-state' }
    );
    const redirectUri = `${urlBackend(event)}/auth/oauth/${nombre}/callback`;
    return redirect(p.urlAutorizacion(p.cfg, redirectUri, state), [cookieOauth(nonce, event, 600)]);
  });
}

// Busca o crea el usuario de una cuenta de Google/Facebook.
async function usuarioDesdeProveedor(campo, perfil) {
  const db = supabase();
  const { data: porId, error } = await db.from('usuarios').select('*').eq(campo, perfil.id).maybeSingle();
  if (error) throw error;
  if (porId) return porId;

  if (!perfil.email) throw new HttpError(400, 'La cuenta no compartió su email; no podemos crear tu usuario.');
  if (!perfil.emailVerificado) throw new HttpError(400, 'El email de esa cuenta no está verificado.');
  const email = perfil.email.toLowerCase();

  const existente = await buscarPorEmail(email);
  if (existente) {
    const cambios = { [campo]: perfil.id, avatar_url: existente.avatar_url || perfil.avatar || null };
    if (!existente.email_verificado_at) {
      // Cuenta creada con contraseña pero nunca confirmada: pudo registrarla
      // otra persona con este email. El dueño real (el del proveedor) la
      // reclama y se descarta esa contraseña.
      cambios.email_verificado_at = new Date().toISOString();
      cambios.password_hash = null;
    }
    const { data, error: e } = await db.from('usuarios').update(cambios).eq('id', existente.id).select('*').single();
    if (e) throw e;
    return data;
  }

  const { data, error: e } = await db
    .from('usuarios')
    .insert({
      email,
      [campo]: perfil.id,
      full_name: perfil.nombre || null,
      avatar_url: perfil.avatar || null,
      email_verificado_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (e) throw e;
  return data;
}

// GET /auth/oauth/{google|facebook}/callback?code&state  (lo llama el proveedor)
function callbackOauth(nombre) {
  return handler(async (event) => {
    const q = event.queryStringParameters || {};
    let destino = '';
    try {
      let state;
      try {
        state = jwt.verify(q.state || '', config.jwt().secret, { audience: 'oauth-state' });
      } catch {
        throw new HttpError(400, 'El ingreso expiró. Intenta de nuevo.');
      }
      destino = state.r;
      if (state.p !== nombre || !state.n || state.n !== cookie(event, COOKIE_OAUTH)) {
        throw new HttpError(400, 'No se pudo validar el ingreso. Intenta de nuevo desde el mismo navegador.');
      }
      if (q.error) throw new HttpError(400, 'Cancelaste el ingreso o el proveedor lo rechazó.');
      if (!q.code) throw new HttpError(400, 'Respuesta inválida del proveedor.');

      const p = proveedor(nombre);
      const perfil = await p.perfil(p.cfg, `${urlBackend(event)}/auth/oauth/${nombre}/callback`, q.code);
      const usuario = await usuarioDesdeProveedor(p.campo, perfil);
      if (!usuario.activo) throw new HttpError(403, 'Usuario desactivado');

      const sesion = await sesiones.crearSesion(usuario.id, userAgent(event));
      return volverAlFrontend(sesion, destino, event);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      const mensaje = err instanceof HttpError ? err.message : 'No se pudo completar el ingreso.';
      return volverAlFrontend({ error_description: mensaje }, destino, event);
    }
  });
}

module.exports.google = iniciarOauth('google');
module.exports.googleCallback = callbackOauth('google');
module.exports.facebook = iniciarOauth('facebook');
module.exports.facebookCallback = callbackOauth('facebook');

module.exports.datosUsuario = datosUsuario;
