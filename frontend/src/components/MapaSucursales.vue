<script setup>
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

// Mapa de OpenStreetMap (Leaflet).
//   puntos    -> marcadores fijos [{ id, latitude, longitude, titulo, detalle }]
//   posicion  -> (v-model) un marcador editable { latitude, longitude } | null;
//                con `editable`, se fija con un clic o arrastrándolo
//   seleccion -> id del punto a destacar (se centra en él)
const props = defineProps({
  puntos: { type: Array, default: () => [] },
  posicion: { type: Object, default: null },
  editable: { type: Boolean, default: false },
  seleccion: { type: String, default: '' },
  alto: { type: String, default: '320px' },
})
const emit = defineEmits(['update:posicion', 'elegir'])

// Centro por defecto: Santiago de Chile.
const CENTRO = [-33.45, -70.66]
const contenedor = ref(null)
let mapa
let capaPuntos
let marcador

const icono = (clase = '') =>
  L.divIcon({ className: '', html: `<span class="pin ${clase}"></span>`, iconSize: [26, 26], iconAnchor: [13, 26] })

const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function dibujarPuntos() {
  capaPuntos.clearLayers()
  for (const p of props.puntos) {
    if (p.latitude == null) continue
    L.marker([p.latitude, p.longitude], { icon: icono(p.id === props.seleccion ? 'destacado' : 'fijo'), title: p.titulo })
      .bindPopup(`<strong>${escapar(p.titulo)}</strong>${p.detalle ? `<br>${escapar(p.detalle)}` : ''}`)
      .on('click', () => emit('elegir', p.id))
      .addTo(capaPuntos)
  }
}

function dibujarPosicion() {
  const pos = props.posicion
  if (!pos || pos.latitude == null) {
    marcador?.remove()
    marcador = null
    return
  }
  const latlng = [pos.latitude, pos.longitude]
  if (marcador) {
    marcador.setLatLng(latlng)
  } else {
    marcador = L.marker(latlng, { icon: icono(), draggable: props.editable, autoPan: true }).addTo(mapa)
    marcador.on('dragend', () => {
      const { lat, lng } = marcador.getLatLng()
      emit('update:posicion', { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) })
    })
  }
}

// Encuadra todo lo visible (o el centro por defecto).
function encuadrar() {
  const coords = [
    ...props.puntos.filter((p) => p.latitude != null).map((p) => [p.latitude, p.longitude]),
    ...(props.posicion?.latitude != null ? [[props.posicion.latitude, props.posicion.longitude]] : []),
  ]
  if (coords.length === 1) mapa.setView(coords[0], 16)
  else if (coords.length) mapa.fitBounds(coords, { padding: [30, 30], maxZoom: 16 })
  else mapa.setView(CENTRO, 11)
}

onMounted(() => {
  mapa = L.map(contenedor.value, { scrollWheelZoom: false })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa)
  capaPuntos = L.layerGroup().addTo(mapa)
  if (props.editable) {
    mapa.on('click', (e) =>
      emit('update:posicion', { latitude: Number(e.latlng.lat.toFixed(6)), longitude: Number(e.latlng.lng.toFixed(6)) })
    )
  }
  dibujarPuntos()
  dibujarPosicion()
  encuadrar()
})

onBeforeUnmount(() => mapa?.remove())

watch(
  () => props.puntos,
  () => {
    dibujarPuntos()
    encuadrar()
  },
  { deep: true }
)
watch(
  () => props.posicion,
  (nueva, anterior) => {
    dibujarPosicion()
    // Centrar solo si vino de fuera (búsqueda / mi ubicación), no al arrastrar.
    if (nueva?.latitude != null && !mapa.getBounds().contains([nueva.latitude, nueva.longitude])) encuadrar()
    else if (nueva?.latitude != null && anterior?.latitude == null) encuadrar()
  }
)
watch(
  () => props.seleccion,
  (id) => {
    dibujarPuntos()
    const p = props.puntos.find((x) => x.id === id && x.latitude != null)
    if (p) mapa.setView([p.latitude, p.longitude], Math.max(mapa.getZoom(), 15))
  }
)

defineExpose({ encuadrar })
</script>

<template>
  <div ref="contenedor" class="mapa" :style="{ height: alto }" role="application" aria-label="Mapa"></div>
</template>

<style scoped>
.mapa {
  width: 100%;
  border-radius: var(--radio);
  border: 1px solid var(--border);
  z-index: 0;
}
.mapa :deep(.pin) {
  display: block;
  width: 26px;
  height: 26px;
  border-radius: 50% 50% 50% 0;
  transform: rotate(-45deg);
  background: var(--acento);
  border: 3px solid #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}
.mapa :deep(.pin.fijo) {
  background: #5b6475;
}
.mapa :deep(.pin.destacado) {
  background: var(--acento);
}
</style>
