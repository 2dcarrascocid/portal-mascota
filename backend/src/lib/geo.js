// Geocodificación con OpenStreetMap (Nominatim): dirección -> coordenadas y
// coordenadas -> dirección. Gratis y sin API key; su política de uso pide
// identificar la app (User-Agent) y no más de ~1 consulta por segundo, por
// eso pasa por el backend y el frontend solo busca al confirmar.
// https://operations.osmfoundation.org/policies/nominatim/
const config = require('./config');
const { HttpError } = require('./http');

const NOMINATIM = 'https://nominatim.openstreetmap.org';

async function consultar(ruta, params) {
  const url = new URL(`${NOMINATIM}/${ruta}`);
  for (const [k, v] of Object.entries({ format: 'jsonv2', addressdetails: 1, 'accept-language': 'es', ...params })) {
    if (v != null && v !== '') url.searchParams.set(k, v);
  }
  let respuesta;
  try {
    respuesta = await fetch(url, {
      headers: { 'User-Agent': `PortalAnimal/1.0 (${config.frontendUrl()})` },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('Nominatim no respondió', err);
    throw new HttpError(502, 'El servicio de mapas no respondió. Intenta de nuevo.');
  }
  if (!respuesta.ok) {
    console.error('Nominatim', respuesta.status, await respuesta.text().catch(() => ''));
    throw new HttpError(502, 'El servicio de mapas no está disponible en este momento');
  }
  return respuesta.json();
}

// Resultado de Nominatim -> { etiqueta, direccion, ciudad, region, latitude, longitude }
function aLugar(r) {
  const a = r.address || {};
  const calle = [a.road || a.pedestrian || a.footway, a.house_number].filter(Boolean).join(' ');
  const ciudad = a.city || a.town || a.village || a.municipality || a.suburb || null;
  return {
    etiqueta: r.display_name,
    direccion: calle || r.name || null,
    ciudad,
    region: a.state || a.region || null,
    latitude: Number(Number(r.lat).toFixed(6)),
    longitude: Number(Number(r.lon).toFixed(6)),
  };
}

// Países donde buscar (códigos ISO separados por coma; vacío = todos).
const paises = () => process.env.GEO_PAISES ?? 'cl';

async function buscar(texto) {
  const resultados = await consultar('search', { q: texto, limit: 6, countrycodes: paises() });
  return resultados.map(aLugar);
}

async function inversa(latitude, longitude) {
  const r = await consultar('reverse', { lat: latitude, lon: longitude, zoom: 18 });
  return r && !r.error ? aLugar(r) : null;
}

// Distancia en km entre dos puntos (fórmula del haversine).
function distanciaKm(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

module.exports = { buscar, inversa, distanciaKm };
