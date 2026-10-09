// Cliente mínimo de la API REST de Webpay Plus (Transbank) v1.2.
const config = require('./config');

const BASE = '/rswebpaytransaction/api/webpay/v1.2/transactions';

async function llamar(method, path, body) {
  const { host, apiKey, commerceCode } = config.webpay();
  const res = await fetch(`${host}${BASE}${path}`, {
    method,
    headers: {
      'Tbk-Api-Key-Id': commerceCode,
      'Tbk-Api-Key-Secret': apiKey,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Webpay ${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// Devuelve { token, url } para redirigir al usuario al formulario de pago.
function crearTransaccion({ buyOrder, sessionId, amount, returnUrl }) {
  return llamar('POST', '', {
    buy_order: buyOrder,
    session_id: sessionId,
    amount,
    return_url: returnUrl,
  });
}

function confirmarTransaccion(token) {
  return llamar('PUT', `/${encodeURIComponent(token)}`);
}

module.exports = { crearTransaccion, confirmarTransaccion };
