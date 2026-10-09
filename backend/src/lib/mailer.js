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
  return transporte.sendMail({ from: smtp.from, to, subject, text, html });
}

module.exports = { enviarCorreo };
