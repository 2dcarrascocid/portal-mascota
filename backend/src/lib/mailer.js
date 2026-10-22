const nodemailer = require('nodemailer');
const config = require('./config');

let transporte;

function enviarCorreo({ to, subject, text, html }) {
  const smtp = config.smtp();
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });
  }
  // Modo pruebas: todo sale a CORREO_REDIRIGIR_A y el asunto conserva el destinatario real.
  if (smtp.redirigirA) {
    const original = [].concat(to).join(', ');
    return transporte.sendMail({ from: smtp.from, to: smtp.redirigirA, subject: `[PRUEBA → ${original}] ${subject}`, text, html });
  }
  return transporte.sendMail({ from: smtp.from, to, subject, text, html });
}

module.exports = { enviarCorreo };
