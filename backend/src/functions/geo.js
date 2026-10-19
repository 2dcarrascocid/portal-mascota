// Búsqueda de direcciones para ubicar sucursales (personal) o la dirección del tutor.
const { requerirUsuario } = require('../lib/auth');
const geo = require('../lib/geo');
const v = require('../lib/validar');
const { HttpError, json, handler } = require('../lib/http');

// GET /geo/buscar?q=Av. Providencia 1234, Providencia
module.exports.buscar = handler(async (event) => {
  await requerirUsuario(event);
  const q = v.texto((event.queryStringParameters || {}).q, 'Búsqueda', { requerido: true, max: 200 });
  if (q.length < 3) throw new HttpError(400, 'Escribe al menos 3 caracteres');
  return json(200, { lugares: await geo.buscar(q) });
});

// GET /geo/inversa?lat=-33.4&lng=-70.6  -> dirección del punto
module.exports.inversa = handler(async (event) => {
  await requerirUsuario(event);
  const q = event.queryStringParameters || {};
  const lugar = await geo.inversa(v.coordenada(q.lat, 'Latitud', 90), v.coordenada(q.lng, 'Longitud', 180));
  return json(200, { lugar });
});
