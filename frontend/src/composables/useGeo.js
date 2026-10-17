import { api } from '../services/api'

// Geocodificación vía backend (OpenStreetMap/Nominatim).
// Lugar: { etiqueta, direccion, ciudad, region, latitude, longitude }

export async function buscarDireccion(q) {
  const { data } = await api.get('/geo/buscar', { params: { q } })
  return data.lugares
}

export async function direccionDe({ latitude, longitude }) {
  const { data } = await api.get('/geo/inversa', { params: { lat: latitude, lng: longitude } })
  return data.lugar
}

// Ubicación del dispositivo (pide permiso al navegador).
export function miUbicacion() {
  return new Promise((resolver, rechazar) => {
    if (!navigator.geolocation) return rechazar(new Error('Este navegador no permite obtener la ubicación'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolver({ latitude: Number(p.coords.latitude.toFixed(6)), longitude: Number(p.coords.longitude.toFixed(6)) }),
      (err) =>
        rechazar(new Error(err.code === err.PERMISSION_DENIED ? 'No diste permiso para usar tu ubicación' : 'No se pudo obtener tu ubicación')),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  })
}
