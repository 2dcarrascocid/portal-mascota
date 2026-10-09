const crypto = require('crypto');
const config = require('../lib/config');
const { crearTransaccion, confirmarTransaccion } = require('../lib/webpay');
const { requerirUsuario } = require('../lib/auth');
const { HttpError, json, redirect, parseJson, parseForm, header, handler } = require('../lib/http');

function urlRetorno(event) {
  const proto = header(event, 'x-forwarded-proto') || 'https';
  return `${proto}://${event.requestContext.domainName}/webpay/retorno`;
}

// POST /webpay/transacciones  { amount }  -> { token, url }
// El frontend debe enviar un form POST a `url` con el campo token_ws = token.
module.exports.crear = handler(async (event) => {
  const usuario = await requerirUsuario(event);
  const { amount } = parseJson(event);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new HttpError(400, 'amount debe ser un entero positivo (CLP)');
  }

  // buy_order: máximo 26 caracteres
  const buyOrder = `PC${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
  const tx = await crearTransaccion({
    buyOrder,
    sessionId: usuario.id,
    amount,
    returnUrl: urlRetorno(event),
  });

  return json(201, { buyOrder, token: tx.token, url: tx.url });
});

// GET|POST /webpay/retorno  (lo llama Transbank, no el frontend)
// Confirma la transacción y redirige al frontend con el resultado.
module.exports.retorno = handler(async (event) => {
  const params = {
    ...(event.queryStringParameters || {}),
    ...(event.requestContext.http.method === 'POST' ? parseForm(event) : {}),
  };
  const destino = new URL(`${config.frontendUrl()}/pago/resultado`);

  // Pago anulado por el usuario o expirado: llegan TBK_* y no token_ws.
  if (!params.token_ws) {
    destino.searchParams.set('estado', 'anulado');
    if (params.TBK_ORDEN_COMPRA) destino.searchParams.set('orden', params.TBK_ORDEN_COMPRA);
    return redirect(destino.toString());
  }

  const resultado = await confirmarTransaccion(params.token_ws);
  const aprobado = resultado.status === 'AUTHORIZED' && resultado.response_code === 0;

  destino.searchParams.set('estado', aprobado ? 'aprobado' : 'rechazado');
  destino.searchParams.set('orden', resultado.buy_order);
  return redirect(destino.toString());
});
