const { enviarCorreo } = require('../lib/mailer');
const { requerirRol } = require('../lib/auth');
const { HttpError, json, parseJson, handler } = require('../lib/http');

// POST /notificaciones/email  { to, subject, text?, html? }
// Solo admin: si cualquier usuario pudiera usarlo, sería un relay de spam.
module.exports.enviarEmail = handler(async (event) => {
  await requerirRol(event, 'SUPER_ADMIN', 'ORG_ADMIN');

  const { to, subject, text, html } = parseJson(event);
  if (!to || !subject || !(text || html)) {
    throw new HttpError(400, 'Se requieren to, subject y text o html');
  }

  const info = await enviarCorreo({ to, subject, text, html });
  return json(202, { messageId: info.messageId });
});
