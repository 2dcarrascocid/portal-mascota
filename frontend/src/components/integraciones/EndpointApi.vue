<script setup>
import { computed, ref } from 'vue'

// Ficha de un endpoint de la API de integración (ver lib/apiIntegracion.js).
const props = defineProps({
  endpoint: { type: Object, required: true },
  urlApi: { type: String, required: true },
})

const e = computed(() => props.endpoint)
const url = computed(() => `${props.urlApi}${e.value.ruta}`)
const jsonTexto = (valor) => (typeof valor === 'string' ? valor : JSON.stringify(valor, null, 2))
const esToken = computed(() => e.value.id === 'token')

// Ejemplo listo para copiar y probar desde la terminal.
const curl = computed(() => {
  const lineas = [`curl -X ${e.value.metodo} "${url.value.replace('{id}', '<id-cita>')}"`]
  if (esToken.value) {
    lineas.push('  -u "<client_id>:<client_secret>"', '  -H "Content-Type: application/x-www-form-urlencoded"', `  -d "${e.value.cuerpo}"`)
  } else {
    lineas.push('  -H "Authorization: Bearer <access_token>"')
    if (e.value.cuerpo) {
      lineas.push('  -H "Content-Type: application/json"', `  -d '${JSON.stringify(e.value.cuerpo)}'`)
    }
  }
  return lineas.join(' \\\n')
})

const copiado = ref('')
let temporizador
async function copiar(clave, texto) {
  try {
    await navigator.clipboard.writeText(texto)
    copiado.value = clave
    clearTimeout(temporizador)
    temporizador = setTimeout(() => (copiado.value = ''), 2000)
  } catch {
    copiado.value = ''
  }
}

const claseCodigo = (codigo) => (codigo < 300 ? 'ok' : codigo < 500 ? 'error' : 'grave')
</script>

<template>
  <details class="endpoint">
    <summary>
      <span class="metodo" :class="e.metodo.toLowerCase()">{{ e.metodo }}</span>
      <code class="ruta">{{ e.ruta }}</code>
      <span class="titulo">{{ e.titulo }}</span>
    </summary>

    <div class="cuerpo">
      <p>{{ e.descripcion }}</p>
      <dl class="meta">
        <dt>URL</dt>
        <dd><code>{{ url }}</code></dd>
        <dt>Autenticación</dt>
        <dd>{{ e.autenticacion || 'Header Authorization: Bearer <access_token>' }}</dd>
        <template v-if="e.contentType">
          <dt>Content-Type</dt>
          <dd>{{ e.contentType }}</dd>
        </template>
      </dl>

      <template v-if="e.parametros?.length">
        <h4>Parámetros</h4>
        <div class="tabla-contenedor">
          <table class="tabla">
            <thead>
              <tr><th>Nombre</th><th>En</th><th>Tipo</th><th>Obligatorio</th><th>Descripción</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in e.parametros" :key="p.nombre">
                <td><code>{{ p.nombre }}</code></td>
                <td>{{ p.en }}</td>
                <td>{{ p.tipo }}</td>
                <td>{{ p.obligatorio ? 'Sí' : 'No' }}</td>
                <td>{{ p.descripcion }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-if="e.cuerpo">
        <h4>Payload (cuerpo)</h4>
        <div class="bloque">
          <button type="button" class="secundario pequeno copiar" @click="copiar('cuerpo', jsonTexto(e.cuerpo))">
            {{ copiado === 'cuerpo' ? 'Copiado ✓' : 'Copiar' }}
          </button>
          <pre><code>{{ jsonTexto(e.cuerpo) }}</code></pre>
        </div>
        <div v-if="e.campos?.length" class="tabla-contenedor">
          <table class="tabla">
            <thead>
              <tr><th>Campo</th><th>Tipo</th><th>Obligatorio</th><th>Descripción</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in e.campos" :key="c.nombre">
                <td><code>{{ c.nombre }}</code></td>
                <td>{{ c.tipo }}</td>
                <td>{{ c.obligatorio ? 'Sí' : 'No' }}</td>
                <td>{{ c.descripcion }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <h4>Respuestas</h4>
      <div v-for="r in e.respuestas" :key="r.codigo" class="respuesta">
        <p>
          <span class="codigo" :class="claseCodigo(r.codigo)">{{ r.codigo }}</span>
          {{ r.descripcion }}
        </p>
        <pre v-if="r.ejemplo"><code>{{ jsonTexto(r.ejemplo) }}</code></pre>
      </div>

      <h4>Ejemplo</h4>
      <div class="bloque">
        <button type="button" class="secundario pequeno copiar" @click="copiar('curl', curl)">
          {{ copiado === 'curl' ? 'Copiado ✓' : 'Copiar' }}
        </button>
        <pre><code>{{ curl }}</code></pre>
      </div>
    </div>
  </details>
</template>

<style scoped>
.endpoint {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--superficie);
}
.endpoint + .endpoint {
  margin-top: 8px;
}
summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  list-style: none;
}
summary::-webkit-details-marker {
  display: none;
}
summary::after {
  content: '▸';
  margin-left: auto;
  color: var(--text-suave);
  transition: transform 0.15s;
}
.endpoint[open] summary::after {
  transform: rotate(90deg);
}
.metodo {
  min-width: 52px;
  text-align: center;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
}
.metodo.get {
  background: color-mix(in srgb, var(--ok) 15%, transparent);
  color: var(--ok);
}
.metodo.post {
  background: var(--acento-bg);
  color: var(--acento);
}
.ruta {
  font-weight: 600;
  color: var(--text-h);
}
.titulo {
  color: var(--text-suave);
}
.cuerpo {
  padding: 4px 14px 14px;
  border-top: 1px solid var(--border);
}
h4 {
  margin: 16px 0 8px;
  color: var(--text-h);
}
.meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 14px;
  margin: 0;
}
.meta dt {
  font-weight: 600;
  color: var(--text-h);
}
.meta dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
code {
  font-size: 0.85rem;
}
pre {
  margin: 0;
  padding: 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--border) 45%, transparent);
  overflow-x: auto;
  font-size: 0.8rem;
  line-height: 1.45;
}
.bloque {
  position: relative;
}
.copiar {
  position: absolute;
  top: 8px;
  right: 8px;
}
.respuesta + .respuesta {
  margin-top: 12px;
}
.respuesta p {
  margin: 0 0 6px;
}
.codigo {
  display: inline-block;
  min-width: 40px;
  text-align: center;
  font-weight: 700;
  font-size: 0.8rem;
  padding: 2px 8px;
  border-radius: 6px;
  margin-right: 6px;
}
.codigo.ok {
  background: color-mix(in srgb, var(--ok) 15%, transparent);
  color: var(--ok);
}
.codigo.error {
  background: color-mix(in srgb, var(--aviso) 18%, transparent);
  color: var(--text-h);
}
.codigo.grave {
  background: color-mix(in srgb, var(--peligro) 14%, transparent);
  color: var(--peligro);
}
@media (max-width: 600px) {
  .meta {
    grid-template-columns: 1fr;
  }
}
</style>
