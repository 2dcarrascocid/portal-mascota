// Lee y normaliza las variables de entorno en un solo lugar.

function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

// Con la clave publishable/anon el backend no puede leer el schema animal.
function claveSecreta(key) {
  if (key.startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY_ANIMAL tiene la clave publishable; usa la secret (sb_secret_…) o la service_role');
  }
  return key;
}

// Proveedor OAuth opcional: devuelve null si no está configurado.
function proveedor(idVar, secretVar) {
  const id = process.env[idVar];
  const secret = process.env[secretVar];
  return id && secret ? { id, secret } : null;
}

module.exports = {
  frontendUrl: () => requerida('FRONTEND_URL').replace(/\/+$/, ''),

  jwt: () => {
    const secret = requerida('ACCESS_TOKEN_SECRET');
    if (secret.length < 32) throw new Error('ACCESS_TOKEN_SECRET debe tener al menos 32 caracteres');
    return { secret, expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m' };
  },

  // Días de vida de una sesión (refresh token).
  diasSesion: () => Number(process.env.SESSION_DAYS || 30),

  google: () => proveedor('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
  facebook: () => proveedor('FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'),

  supabase: () => ({
    // supabase-js necesita la URL base del proyecto, sin /rest/v1
    url: new URL(requerida('SUPABASE_URL_ANIMAL')).origin,
    key: claveSecreta(requerida('SUPABASE_SERVICE_ROLE_KEY_ANIMAL')),
    // Schema de la aplicación (debe estar en Settings > Data API > Exposed schemas)
    schema: 'animal',
  }),

  smtp: () => ({
    host: requerida('SMTP_HOST'),
    port: Number(requerida('SMTP_PORT')),
    secure: process.env.SMTP_SECURE === 'true',
    user: requerida('SMTP_USER'),
    pass: requerida('SMTP_PASS'),
    from: requerida('SMTP_FROM'),
  }),

  webpay: () => ({
    host: requerida('WEBPAY_HOST').replace(/\/+$/, ''),
    apiKey: requerida('WEBPAY_API_KEY'),
    commerceCode: requerida('WEBPAY_COMMERCE_CODE'),
  }),
};
