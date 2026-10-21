<script setup>
import { computed, onMounted, ref } from 'vue'
import { useIntegrations } from '../composables/useIntegrations'
import { mensajeError } from '../services/api'
import { confirmar } from '../composables/useDialogo'
import { ENDPOINTS_INTEGRACION } from '../lib/apiIntegracion'
import EndpointApi from '../components/integraciones/EndpointApi.vue'

const { items: credenciales, cargando, error, cargar, crear, revocar, urlApi } = useIntegrations()

// Endpoints agrupados por servicio (Conectividad, Búsqueda, …) en el orden del catálogo.
const gruposEndpoints = computed(() => {
  const grupos = new Map()
  for (const e of ENDPOINTS_INTEGRACION) {
    if (!grupos.has(e.grupo)) grupos.set(e.grupo, [])
    grupos.get(e.grupo).push(e)
  }
  return [...grupos.entries()].map(([nombre, endpoints]) => ({ nombre, endpoints }))
})

onMounted(cargar)

const activas = computed(() => credenciales.value.filter((c) => !c.revoked_at).length)

const fechaHora = (iso) =>
  iso ? new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—'

// ── Copiar al portapapeles ───────────────────────────────────
const copiado = ref('')
let temporizador
async function copiar(clave, texto) {
  try {
    await navigator.clipboard.writeText(texto)
    copiado.value = clave
    clearTimeout(temporizador)
    temporizador = setTimeout(() => (copiado.value = ''), 2000)
  } catch {
    error.value = 'No se pudo copiar: selecciona el texto y cópialo a mano.'
  }
}

// ── Nueva conexión ───────────────────────────────────────────
const mostrarForm = ref(false)
const nombre = ref('')
const errorForm = ref('')
const guardando = ref(false)

function nueva() {
  nombre.value = ''
  errorForm.value = ''
  mostrarForm.value = true
}

// Credencial recién creada: la única vez que se ve el client_secret.
const recien = ref(null)
const secretoCopiado = ref(false)

async function guardar() {
  errorForm.value = ''
  guardando.value = true
  try {
    recien.value = await crear({ name: nombre.value })
    secretoCopiado.value = false
    mostrarForm.value = false
  } catch (err) {
    errorForm.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}

async function copiarSecreto() {
  await copiar('secreto', recien.value.client_secret)
  if (copiado.value === 'secreto') secretoCopiado.value = true
}

async function cerrarRecien() {
  if (
    !secretoCopiado.value &&
    !(await confirmar({
      titulo: 'Cerrar sin copiar',
      mensaje: 'El client secret no se volverá a mostrar. Si no lo guardaste, tendrás que crear otra conexión.',
      aceptar: 'Cerrar de todos modos',
      peligro: true,
    }))
  ) {
    return
  }
  recien.value = null
}

// ── Revocar ──────────────────────────────────────────────────
async function quitar(c) {
  const ok = await confirmar({
    titulo: 'Revocar conexión',
    mensaje: `¿Revocar "${c.name}"? El servicio externo perderá el acceso de inmediato y no se puede reactivar.`,
    aceptar: 'Revocar',
    peligro: true,
  })
  if (!ok) return
  try {
    await revocar(c.id)
  } catch (err) {
    error.value = mensajeError(err)
  }
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Integraciones</h1>
      <button v-if="!mostrarForm && !recien" @click="nueva">+ Nueva conexión</button>
    </div>
    <p class="suave">
      Credenciales para que servicios externos, como el sistema de contactabilidad, consulten la agenda y confirmen o
      liberen citas. Cada conexión ve solo las citas de esta entidad. Crea una por proveedor, para poder revocarla sin
      afectar a los demás.
    </p>

    <!-- Datos que se entregan al proveedor junto con la credencial -->
    <section class="panel">
      <h2>Datos de conexión</h2>
      <dl class="datos">
        <dt>URL base de la API</dt>
        <dd>
          <code>{{ urlApi }}</code>
          <button class="secundario pequeno" @click="copiar('url', urlApi)">{{ copiado === 'url' ? 'Copiado ✓' : 'Copiar' }}</button>
        </dd>
        <dt>Obtener token</dt>
        <dd>
          <code>POST {{ urlApi }}/oauth/token</code>
          <small class="suave">OAuth2 <em>client credentials</em>: <code>grant_type=client_credentials</code>, token de 1 hora.</small>
        </dd>
      </dl>
    </section>

    <!-- Catálogo de endpoints para el proveedor -->
    <section class="panel">
      <h2>Endpoints de la API</h2>
      <p class="suave">
        Lo que puede hacer el servicio externo, con sus parámetros, payload y respuestas. Haz clic en cada uno para ver
        el detalle. Todas las llamadas, salvo la del token, llevan el header <code>Authorization: Bearer &lt;token&gt;</code>.
      </p>
      <div v-for="g in gruposEndpoints" :key="g.nombre" class="grupo-endpoints">
        <h3>{{ g.nombre }}</h3>
        <EndpointApi v-for="e in g.endpoints" :key="e.id" :endpoint="e" :url-api="urlApi" />
      </div>
    </section>

    <!-- Alta -->
    <form v-if="mostrarForm" class="panel" @submit.prevent="guardar">
      <h2>Nueva conexión</h2>
      <label>
        Nombre del servicio
        <input v-model="nombre" required maxlength="120" placeholder="Ej: Contactabilidad – Proveedor X" />
      </label>
      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Creando…' : 'Crear credenciales' }}</button>
        <button type="button" class="secundario" @click="mostrarForm = false">Cancelar</button>
      </div>
    </form>

    <!-- Credenciales recién creadas (el secreto se ve una sola vez) -->
    <section v-if="recien" class="panel recien" aria-live="polite">
      <h2>Credenciales de «{{ recien.name }}»</h2>
      <p class="advertencia" role="alert">
        Copia el <strong>client secret</strong> ahora y entrégalo al proveedor por un canal seguro. Por seguridad no se
        guarda y <strong>no se volverá a mostrar</strong>.
      </p>
      <dl class="datos">
        <dt>Client ID</dt>
        <dd>
          <code>{{ recien.client_id }}</code>
          <button class="secundario pequeno" @click="copiar('id-nuevo', recien.client_id)">
            {{ copiado === 'id-nuevo' ? 'Copiado ✓' : 'Copiar' }}
          </button>
        </dd>
        <dt>Client secret</dt>
        <dd>
          <code class="secreto">{{ recien.client_secret }}</code>
          <button class="pequeno" @click="copiarSecreto">{{ copiado === 'secreto' ? 'Copiado ✓' : 'Copiar' }}</button>
        </dd>
      </dl>
      <div class="acciones">
        <button type="button" class="secundario" @click="cerrarRecien">Ya lo guardé, cerrar</button>
      </div>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <!-- Listado -->
    <section class="panel tabla-contenedor">
      <p v-if="cargando" class="vacio">Cargando…</p>
      <table v-else class="tabla">
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Client ID</th>
            <th>Creada</th>
            <th>Último uso</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in credenciales" :key="c.id" :class="{ revocada: c.revoked_at }">
            <td><strong>{{ c.name }}</strong></td>
            <td>
              <div class="copiable">
                <code>{{ c.client_id }}</code>
                <button
                  class="secundario pequeno"
                  :aria-label="`Copiar client ID de ${c.name}`"
                  @click="copiar(c.id, c.client_id)"
                >
                  {{ copiado === c.id ? '✓' : 'Copiar' }}
                </button>
              </div>
            </td>
            <td>{{ fechaHora(c.created_at) }}</td>
            <td>
              {{ fechaHora(c.last_used_at) }}
              <div v-if="!c.last_used_at && !c.revoked_at"><small class="suave">Aún no se conecta</small></div>
            </td>
            <td>
              <span v-if="c.revoked_at" class="chip inactiva">Revocada {{ fechaHora(c.revoked_at) }}</span>
              <span v-else class="chip activa">Activa</span>
            </td>
            <td>
              <button v-if="!c.revoked_at" class="peligro pequeno" @click="quitar(c)">Revocar</button>
            </td>
          </tr>
          <tr v-if="!credenciales.length">
            <td colspan="6" class="vacio">Aún no hay conexiones. Crea la primera para el sistema de contactabilidad.</td>
          </tr>
        </tbody>
      </table>
      <p v-if="credenciales.length" class="pie suave">
        {{ activas }} activa(s). Para cambiar el secreto de un proveedor: crea una conexión nueva, espera a que aparezca
        su "último uso" y revoca la anterior.
      </p>
    </section>
  </main>
</template>

<style scoped>
.datos {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 10px 16px;
  margin: 0;
  align-items: center;
}
.datos dt {
  font-weight: 600;
  color: var(--text-h);
}
.datos dd {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
code {
  font-size: 0.85rem;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--border);
  overflow-wrap: anywhere;
}
.secreto {
  background: color-mix(in srgb, var(--aviso) 18%, transparent);
  color: var(--text-h);
}
.recien {
  border-color: var(--aviso);
}
.advertencia {
  padding: 10px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--aviso) 14%, transparent);
  color: var(--text-h);
}
.copiable {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chip.activa {
  background: color-mix(in srgb, var(--ok) 15%, transparent);
  color: var(--ok);
}
.chip.inactiva {
  background: color-mix(in srgb, var(--peligro) 14%, transparent);
  color: var(--peligro);
}
.revocada td {
  opacity: 0.65;
}
.grupo-endpoints h3 {
  margin: 18px 0 8px;
  font-size: 0.95rem;
}
.pie {
  margin: 12px 0 0;
  font-size: 0.85rem;
}
@media (max-width: 600px) {
  .datos {
    grid-template-columns: 1fr;
  }
}
</style>
