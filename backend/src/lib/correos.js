// Correos de cuenta: verificación, recuperación, invitación de personal.
// Los enlaces llevan un token de un solo uso; en la base solo queda su hash.
const config = require('./config');
const { supabase } = require('./supabase');
const { sha256, tokenAleatorio } = require('./sesiones');
const { enviarCorreo } = require('./mailer');

const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const saludo = (nombre) => `Hola${nombre ? ` ${nombre}` : ''}:`;

async function emitirTokenCorreo(usuarioId, tipo, horas) {
  const token = tokenAleatorio();
  const { error } = await supabase()
    .from('tokens_usuario')
    .insert({
      token_hash: sha256(token),
      usuario_id: usuarioId,
      tipo,
      expira_at: new Date(Date.now() + horas * 3_600_000).toISOString(),
    });
  if (error) throw error;
  return token;
}

async function enviarVerificacion(usuario) {
  const token = await emitirTokenCorreo(usuario.id, 'verificar_email', 24);
  const url = `${config.frontendUrl()}/auth/verificar?token=${token}`;
  await enviarCorreo({
    to: usuario.email,
    subject: 'Confirma tu cuenta en Portal Animal',
    text: `${saludo(usuario.full_name)}\n\nConfirma tu cuenta abriendo este enlace (vence en 24 horas):\n${url}\n\nSi no creaste esta cuenta, ignora este correo.`,
    html: `<p>${escapar(saludo(usuario.full_name))}</p><p>Confirma tu cuenta en Portal Animal:</p><p><a href="${url}">Confirmar mi cuenta</a></p><p>El enlace vence en 24 horas. Si no creaste esta cuenta, ignora este correo.</p>`,
  });
}

async function enviarRecuperacion(usuario) {
  const token = await emitirTokenCorreo(usuario.id, 'restablecer_password', 1);
  const url = `${config.frontendUrl()}/restablecer?token=${token}`;
  await enviarCorreo({
    to: usuario.email,
    subject: 'Restablece tu contraseña de Portal Animal',
    text: `Para crear una contraseña nueva abre este enlace (vence en 1 hora):\n${url}\n\nSi no lo pediste, ignora este correo: tu contraseña no cambia.`,
    html: `<p>Para crear una contraseña nueva en Portal Animal:</p><p><a href="${url}">Restablecer contraseña</a></p><p>El enlace vence en 1 hora. Si no lo pediste, ignora este correo: tu contraseña no cambia.</p>`,
  });
}

// Personal creado por un administrador: el enlace le permite crear su
// contraseña (usa el mismo flujo que la recuperación, con más plazo).
const HORAS_INVITACION = 72;

async function enviarInvitacion(usuario, organizacion) {
  const token = await emitirTokenCorreo(usuario.id, 'restablecer_password', HORAS_INVITACION);
  const url = `${config.frontendUrl()}/restablecer?token=${token}&invitacion=1`;
  await enviarCorreo({
    to: usuario.email,
    subject: `Te invitaron a ${organizacion} en Portal Animal`,
    text: `${saludo(usuario.full_name)}\n\n${organizacion} te agregó a su equipo en Portal Animal.\nCrea tu contraseña con este enlace (vence en 3 días):\n${url}\n\nTambién puedes ingresar con Google usando este mismo email.`,
    html: `<p>${escapar(saludo(usuario.full_name))}</p><p><strong>${escapar(organizacion)}</strong> te agregó a su equipo en Portal Animal.</p><p><a href="${url}">Crear mi contraseña</a></p><p>El enlace vence en 3 días. También puedes ingresar con Google usando este mismo email.</p>`,
  });
}

// Usuario que ya tenía cuenta y fue sumado a una organización.
async function avisarIncorporacion(usuario, organizacion) {
  const url = `${config.frontendUrl()}/login`;
  await enviarCorreo({
    to: usuario.email,
    subject: `Ahora eres parte de ${organizacion} en Portal Animal`,
    text: `${saludo(usuario.full_name)}\n\n${organizacion} te agregó a su equipo en Portal Animal. Ingresa con tu cuenta de siempre:\n${url}`,
    html: `<p>${escapar(saludo(usuario.full_name))}</p><p><strong>${escapar(organizacion)}</strong> te agregó a su equipo en Portal Animal.</p><p><a href="${url}">Ingresar</a> con tu cuenta de siempre.</p>`,
  });
}

module.exports = { enviarVerificacion, enviarRecuperacion, enviarInvitacion, avisarIncorporacion };
