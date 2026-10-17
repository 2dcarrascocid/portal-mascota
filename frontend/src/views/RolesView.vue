<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoles } from '../composables/useRoles'
import { mensajeError } from '../services/api'

const { items: roles, catalogo, cargando, error, cargar, crear, actualizar, eliminar } = useRoles()

onMounted(cargar)

const ETIQUETAS_ACCION = { ver: 'Ver', crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' }

// Módulos agrupados (Configuración / Operación) para la matriz.
const grupos = computed(() => {
  const mapa = new Map()
  for (const m of catalogo.value.modulos) {
    if (!mapa.has(m.grupo)) mapa.set(m.grupo, [])
    mapa.get(m.grupo).push(m)
  }
  return [...mapa.entries()].map(([nombre, modulos]) => ({ nombre, modulos }))
})

const nombreModulo = (clave) => catalogo.value.modulos.find((m) => m.clave === clave)?.nombre ?? clave

// Resumen legible: "Agendas (ver, crear) · Tutores (ver)".
function resumen(permisos) {
  const porModulo = new Map()
  for (const p of permisos) {
    const [modulo, accion] = p.split('.')
    if (!porModulo.has(modulo)) porModulo.set(modulo, [])
    porModulo.get(modulo).push(accion)
  }
  return [...porModulo.entries()].map(([m, acciones]) => ({
    modulo: nombreModulo(m),
    acciones: acciones.length === catalogo.value.acciones.length ? 'todo' : acciones.join(', '),
  }))
}

// ── Formulario ───────────────────────────────────────────────
const vacio = () => ({ name: '', description: '', permissions: [] })
const form = reactive(vacio())
const editando = ref(null)
const mostrarForm = ref(false)
const errorForm = ref('')
const guardando = ref(false)

function nuevo(base = null) {
  Object.assign(form, vacio(), base ? { permissions: [...base] } : {})
  editando.value = null
  errorForm.value = ''
  mostrarForm.value = true
}

function editar(r) {
  Object.assign(form, { name: r.name, description: r.description ?? '', permissions: [...r.permissions] })
  editando.value = r.id
  errorForm.value = ''
  mostrarForm.value = true
}

const tiene = (modulo, accion) => form.permissions.includes(`${modulo}.${accion}`)

// Marcar una acción marca también "ver"; desmarcar "ver" quita las demás
// (no se edita lo que no se puede ver).
function alternar(modulo, accion) {
  const codigo = `${modulo}.${accion}`
  if (tiene(modulo, accion)) {
    form.permissions = form.permissions.filter((p) => (accion === 'ver' ? !p.startsWith(`${modulo}.`) : p !== codigo))
  } else {
    form.permissions = [...new Set([...form.permissions, codigo, `${modulo}.ver`])]
  }
}

const filaCompleta = (modulo) => catalogo.value.acciones.every((a) => tiene(modulo, a))
function alternarFila(modulo) {
  const completa = filaCompleta(modulo)
  form.permissions = form.permissions.filter((p) => !p.startsWith(`${modulo}.`))
  if (!completa) form.permissions.push(...catalogo.value.acciones.map((a) => `${modulo}.${a}`))
}

async function guardar() {
  errorForm.value = ''
  guardando.value = true
  try {
    if (editando.value) await actualizar(editando.value, { ...form })
    else await crear({ ...form })
    mostrarForm.value = false
  } catch (err) {
    errorForm.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}

async function borrar(r) {
  const detalle = r.total_personal ? ` ${r.total_personal} persona(s) volverán a los permisos básicos.` : ''
  if (!confirm(`¿Eliminar el rol "${r.name}"?${detalle}`)) return
  try {
    await eliminar(r.id)
  } catch (err) {
    error.value = mensajeError(err)
  }
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <h1>Roles y permisos</h1>
      <button v-if="!mostrarForm" @click="nuevo()">+ Nuevo rol</button>
    </div>
    <p class="suave">
      Un rol define qué puede ver y hacer cada integrante del personal. Se asigna en
      <RouterLink :to="{ name: 'config-personal' }">Personal</RouterLink>. Los cambios rigen de inmediato.
    </p>

    <form v-if="mostrarForm" class="panel" @submit.prevent="guardar">
      <h2>{{ editando ? 'Editar rol' : 'Nuevo rol' }}</h2>
      <div class="grilla-form">
        <label>Nombre <input v-model="form.name" required maxlength="60" placeholder="Ej: Recepción" /></label>
        <label>Descripción <input v-model="form.description" maxlength="300" /></label>
      </div>

      <div class="tabla-contenedor matriz">
        <table class="tabla">
          <template v-for="g in grupos" :key="g.nombre">
            <thead>
              <tr>
                <th>{{ g.nombre }}</th>
                <th v-for="a in catalogo.acciones" :key="a" class="centro">{{ ETIQUETAS_ACCION[a] || a }}</th>
                <th class="centro">Todo</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in g.modulos" :key="m.clave">
                <td>{{ m.nombre }}</td>
                <td v-for="a in catalogo.acciones" :key="a" class="centro">
                  <input
                    type="checkbox"
                    :checked="tiene(m.clave, a)"
                    :aria-label="`${m.nombre}: ${ETIQUETAS_ACCION[a] || a}`"
                    @change="alternar(m.clave, a)"
                  />
                </td>
                <td class="centro">
                  <input
                    type="checkbox"
                    :checked="filaCompleta(m.clave)"
                    :aria-label="`${m.nombre}: todos los permisos`"
                    @change="alternarFila(m.clave)"
                  />
                </td>
              </tr>
            </tbody>
          </template>
        </table>
      </div>

      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
        <button type="button" class="secundario" @click="mostrarForm = false">Cancelar</button>
      </div>
    </form>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section class="panel tabla-contenedor">
      <p v-if="cargando" class="vacio">Cargando…</p>
      <table v-else class="tabla">
        <thead>
          <tr>
            <th>Rol</th>
            <th>Permisos</th>
            <th>Personal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr class="fijo">
            <td>
              <strong>Administrador</strong> <span class="chip gris">Cargo</span>
              <div><small class="suave">Cargo de administrador de la entidad. No se puede modificar.</small></div>
            </td>
            <td><span class="chip">Acceso total, incluye roles y permisos</span></td>
            <td>—</td>
            <td></td>
          </tr>
          <tr class="fijo">
            <td>
              <strong>Permisos básicos</strong> <span class="chip gris">Sin rol</span>
              <div><small class="suave">Personal al que no se le ha asignado un rol.</small></div>
            </td>
            <td>
              <div class="chips">
                <span v-for="r in resumen(catalogo.basicos)" :key="r.modulo" class="chip gris">
                  {{ r.modulo }} · {{ r.acciones }}
                </span>
              </div>
            </td>
            <td>—</td>
            <td>
              <button class="secundario pequeno" @click="nuevo(catalogo.basicos)">Usar como base</button>
            </td>
          </tr>
          <tr v-for="r in roles" :key="r.id">
            <td>
              <strong>{{ r.name }}</strong>
              <div v-if="r.description"><small class="suave">{{ r.description }}</small></div>
            </td>
            <td>
              <div v-if="r.permissions.length" class="chips">
                <span v-for="x in resumen(r.permissions)" :key="x.modulo" class="chip">{{ x.modulo }} · {{ x.acciones }}</span>
              </div>
              <span v-else class="suave">Sin permisos</span>
            </td>
            <td>{{ r.total_personal || '—' }}</td>
            <td>
              <div class="acciones">
                <button class="secundario pequeno" @click="editar(r)">Editar</button>
                <button class="peligro pequeno" @click="borrar(r)">Eliminar</button>
              </div>
            </td>
          </tr>
          <tr v-if="!roles.length">
            <td colspan="4" class="vacio">Aún no hay roles propios. Crea el primero (ej: Recepción, Veterinario jefe).</td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>

<style scoped>
.matriz {
  margin-top: 16px;
}
.matriz input[type='checkbox'] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}
.centro {
  text-align: center !important;
}
.fijo td {
  background: color-mix(in srgb, var(--border) 25%, transparent);
}
</style>
