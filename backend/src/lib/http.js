// Helpers de request/response para handlers HTTP API (payload v2).

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// `cookies`: lista de Set-Cookie (formato de respuesta HTTP API v2).
function redirect(location, cookies) {
  return { statusCode: 302, headers: { Location: location }, ...(cookies && { cookies }), body: '' };
}

// Valor de una cookie del request (HTTP API v2 las manda en event.cookies).
function cookie(event, nombre) {
  const lista = event.cookies || (header(event, 'cookie') || '').split(';');
  for (const c of lista) {
    const [clave, ...valor] = c.trim().split('=');
    if (clave === nombre) return decodeURIComponent(valor.join('='));
  }
  return undefined;
}

function rawBody(event) {
  if (!event.body) return '';
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

function parseJson(event) {
  const raw = rawBody(event);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'El cuerpo debe ser JSON válido');
  }
}

function parseForm(event) {
  return Object.fromEntries(new URLSearchParams(rawBody(event)));
}

function header(event, nombre) {
  const headers = event.headers || {};
  const clave = Object.keys(headers).find((k) => k.toLowerCase() === nombre.toLowerCase());
  return clave ? headers[clave] : undefined;
}

// Envuelve un handler: convierte HttpError en respuesta y loguea lo inesperado.
function handler(fn) {
  return async (event, context) => {
    try {
      return await fn(event, context);
    } catch (err) {
      if (err instanceof HttpError) return json(err.statusCode, { error: err.message });
      console.error(err);
      return json(500, { error: 'Error interno del servidor' });
    }
  };
}

module.exports = { HttpError, json, redirect, cookie, parseJson, parseForm, header, handler };
