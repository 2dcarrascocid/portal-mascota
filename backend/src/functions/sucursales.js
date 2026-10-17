const { supabase, errorDb } = require('../lib/supabase');
const { requerirPersonal, requerirPermiso, sucursalesDe, requerirSucursal, deLaOrganizacion } = require('../lib/acceso');
const { distanciaKm } = require('../lib/geo');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');

const COLUMNAS = 'id, name, address, city, region, latitude, longitude, phone, email, is_active, created_at';

function datos(body) {
  const latitude = v.coordenada(body.latitude, 'Latitud', 90, { requerido: false });
  const longitude = v.coordenada(body.longitude, 'Longitud', 180, { requerido: false });
  if ((latitude == null) !== (longitude == null)) throw new HttpError(400, 'Indica latitud y longitud, o ninguna');
  return {
    name: v.texto(body.name, 'Nombre', { requerido: true, max: 120 }),
    address: v.texto(body.address, 'Dirección'),
    city: v.texto(body.city, 'Comuna / ciudad', { max: 120 }),
    region: v.texto(body.region, 'Región', { max: 120 }),
    latitude,
    longitude,
    phone: v.texto(body.phone, 'Teléfono', { max: 40 }),
    email: v.email(body.email, 'Email'),
    is_active: v.booleano(body.is_active),
  };
}

// numeric llega como texto desde PostgREST.
const aPublico = (s) => ({
  ...s,
  latitude: s.latitude == null ? null : Number(s.latitude),
  longitude: s.longitude == null ? null : Number(s.longitude),
});

const normalizar = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// GET /sucursales?q=&lat=&lng=  -> admin: todas; especialista: solo las asignadas
//   q        filtra por nombre, dirección, comuna o región (sin tildes)
//   lat,lng  agrega distancia_km y ordena de la más cercana a la más lejana
module.exports.listar = handler(async (event) => {
  const usuario = await requerirPersonal(event);
  const q = event.queryStringParameters || {};
  let consulta = supabase()
    .from('branches')
    .select(COLUMNAS)
    .eq('organization_id', usuario.organization_id)
    .order('name');
  const permitidas = await sucursalesDe(usuario);
  if (permitidas) consulta = consulta.in('id', permitidas);

  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  let sucursales = data.map(aPublico);

  const texto = normalizar(q.q).trim();
  if (texto) {
    sucursales = sucursales.filter((s) =>
      [s.name, s.address, s.city, s.region].some((x) => normalizar(x).includes(texto))
    );
  }
  if (q.lat != null || q.lng != null) {
    const punto = { latitude: v.coordenada(q.lat, 'lat', 90), longitude: v.coordenada(q.lng, 'lng', 180) };
    sucursales = sucursales
      .map((s) => ({
        ...s,
        distancia_km: s.latitude == null ? null : Number(distanciaKm(punto, s).toFixed(2)),
      }))
      // Sin ubicación, al final.
      .sort((a, b) => (a.distancia_km ?? Infinity) - (b.distancia_km ?? Infinity));
  }
  return json(200, { sucursales });
});

// POST /sucursales
module.exports.crear = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'sucursales.crear');
  const { data, error } = await supabase()
    .from('branches')
    .insert({ ...datos(parseJson(event)), organization_id: usuario.organization_id })
    .select(COLUMNAS)
    .single();
  if (error) throw errorDb(error);
  return json(201, { sucursal: aPublico(data) });
});

// PUT /sucursales/{id}
module.exports.actualizar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'sucursales.editar');
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('branches', id, usuario);
  await requerirSucursal(usuario, id);

  const { data, error } = await supabase()
    .from('branches')
    .update(datos(parseJson(event)))
    .eq('id', id)
    .select(COLUMNAS)
    .single();
  if (error) throw errorDb(error);
  return json(200, { sucursal: aPublico(data) });
});

// DELETE /sucursales/{id}  (borra también sus asignaciones y agendas)
module.exports.eliminar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'sucursales.eliminar');
  const id = v.uuid(event.pathParameters.id, 'id');
  await deLaOrganizacion('branches', id, usuario);
  await requerirSucursal(usuario, id);

  const { error } = await supabase().from('branches').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { ok: true });
});
