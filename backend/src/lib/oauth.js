// Login con Google/Facebook (OAuth 2.0, flujo "authorization code" en el
// servidor): el frontend solo navega al backend; client secrets y canje del
// código quedan aquí.
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const config = require('./config');
const { HttpError } = require('./http');

const FB = 'https://graph.facebook.com/v21.0';

const consulta = (params) => new URLSearchParams(params).toString();

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, body.error?.message || 'El proveedor rechazó el ingreso');
  return body;
}

// perfil(): { id, email, emailVerificado, nombre, avatar }
const PROVEEDORES = {
  google: {
    campo: 'google_sub',
    config: config.google,
    urlAutorizacion: (cfg, redirectUri, state) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${consulta({
        client_id: cfg.id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        prompt: 'select_account',
        state,
      })}`,
    async perfil(cfg, redirectUri, code) {
      const client = new OAuth2Client(cfg.id, cfg.secret, redirectUri);
      const { tokens } = await client.getToken(code);
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: cfg.id });
      const p = ticket.getPayload();
      return { id: p.sub, email: p.email, emailVerificado: !!p.email_verified, nombre: p.name, avatar: p.picture };
    },
  },
  facebook: {
    campo: 'facebook_id',
    config: config.facebook,
    urlAutorizacion: (cfg, redirectUri, state) =>
      `https://www.facebook.com/v21.0/dialog/oauth?${consulta({
        client_id: cfg.id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'email,public_profile',
        state,
      })}`,
    async perfil(cfg, redirectUri, code) {
      const { access_token: token } = await getJson(
        `${FB}/oauth/access_token?${consulta({ client_id: cfg.id, client_secret: cfg.secret, redirect_uri: redirectUri, code })}`
      );
      const proof = crypto.createHmac('sha256', cfg.secret).update(token).digest('hex');
      const me = await getJson(
        `${FB}/me?${consulta({ fields: 'id,name,email,picture.type(large)', access_token: token, appsecret_proof: proof })}`
      );
      // Facebook solo entrega emails confirmados.
      return { id: me.id, email: me.email, emailVerificado: !!me.email, nombre: me.name, avatar: me.picture?.data?.url };
    },
  },
};

function proveedor(nombre) {
  const p = PROVEEDORES[nombre];
  const cfg = p?.config();
  if (!cfg) throw new HttpError(503, `El ingreso con ${nombre} no está configurado`);
  return { ...p, cfg };
}

module.exports = { proveedor };
