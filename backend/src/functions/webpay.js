const crypto = require('crypto');
const config = require('../lib/config');
const { supabase } = require('../lib/supabase');
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

// ── Pagos de reservas del portal del tutor (online_payments) ─

async function pagoPorToken(token) {
  if (!token) return null;
  const { data, error } = await supabase()
    .from('online_payments')
    .select('id, appointment_id, amount, status')
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Pago anulado o rechazado: la cita sigue pendiente (retiene el turno hasta
// que vence) para que el tutor pueda reintentar desde "Mis citas".
async function cerrarPagoFallido(pago, status, respuesta) {
  const { error } = await supabase()
    .from('online_payments')
    .update({ status, response: respuesta ?? null, confirmed_at: new Date().toISOString() })
    .eq('id', pago.id)
    .eq('status', 'PENDIENTE');
  if (error) throw error;
}

// Pago aprobado: marca la cita como pagada. Si la reserva ya había vencido,
// intenta reactivarla; si el turno ya se tomó, el pago queda para devolución.
// Devuelve true si la cita quedó pagada.
async function aplicarPagoAprobado(pago, resultado) {
  const db = supabase();
  const { data: actualizado, error } = await db
    .from('online_payments')
    .update({
      status: 'APROBADO',
      authorization_code: resultado.authorization_code ?? null,
      card_last_digits: resultado.card_detail?.card_number ?? null,
      response: resultado,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', pago.id)
    .eq('status', 'PENDIENTE')
    .select('id');
  if (error) throw error;
  if (!actualizado.length || !pago.appointment_id) return !!pago.appointment_id;

  const ahora = new Date().toISOString();
  const { data: pagada, error: errorCita } = await db
    .from('appointments')
    .update({ payment_status: 'PAGADO', payment_expires_at: null, updated_at: ahora })
    .eq('id', pago.appointment_id)
    .eq('payment_status', 'PENDIENTE')
    .neq('status', 'CANCELADA')
    .select('id');
  if (errorCita) throw errorCita;
  if (pagada.length) return true;

  const { data: reactivada, error: errorReactivar } = await db
    .from('appointments')
    .update({ status: 'RESERVADA', cancel_reason: null, payment_status: 'PAGADO', payment_expires_at: null, updated_at: ahora })
    .eq('id', pago.appointment_id)
    .eq('status', 'CANCELADA')
    .eq('cancel_reason', 'Pago en línea no completado')
    .select('id');
  if (!errorReactivar && reactivada.length) return true;

  // 23505: el turno ya lo reservó otra persona.
  if (errorReactivar && errorReactivar.code !== '23505') console.error(errorReactivar);
  await db.from('online_payments').update({ requires_refund: true }).eq('id', pago.id);
  console.error('Pago aprobado sin cita vigente: requiere devolución', pago.id);
  return false;
}

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
    const pago = await pagoPorToken(params.TBK_TOKEN);
    if (pago) {
      await cerrarPagoFallido(pago, 'ANULADO');
      if (pago.appointment_id) destino.searchParams.set('cita', pago.appointment_id);
    }
    return redirect(destino.toString());
  }

  const pago = await pagoPorToken(params.token_ws);
  let resultado;
  try {
    resultado = await confirmarTransaccion(params.token_ws);
  } catch (err) {
    // Token ya confirmado (recarga de la página) o error de Transbank.
    console.error('No se pudo confirmar la transacción Webpay', err);
    destino.searchParams.set('estado', pago?.status === 'APROBADO' ? 'aprobado' : 'error');
    if (pago?.appointment_id) destino.searchParams.set('cita', pago.appointment_id);
    return redirect(destino.toString());
  }

  // El monto confirmado debe ser el que se cobró por la reserva.
  const aprobado =
    resultado.status === 'AUTHORIZED' &&
    resultado.response_code === 0 &&
    (!pago || Number(resultado.amount) === Number(pago.amount));

  destino.searchParams.set('orden', resultado.buy_order);
  if (pago) {
    if (pago.appointment_id) destino.searchParams.set('cita', pago.appointment_id);
    if (aprobado) {
      const conCita = await aplicarPagoAprobado(pago, resultado);
      destino.searchParams.set('estado', conCita ? 'aprobado' : 'sin_cita');
      return redirect(destino.toString());
    }
    await cerrarPagoFallido(pago, 'RECHAZADO', resultado);
  }
  destino.searchParams.set('estado', aprobado ? 'aprobado' : 'rechazado');
  return redirect(destino.toString());
});

module.exports.urlRetorno = urlRetorno;
