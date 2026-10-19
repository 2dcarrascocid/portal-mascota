<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useBranches } from '../composables/useBranches'
import { useRoles } from '../composables/useRoles'
import { useSpecialties } from '../composables/useSpecialties'
import { useStaff } from '../composables/useStaff'
import { formatearRut } from '../lib/rut'
import { mensajeError } from '../services/api'
import NuevoIntegrante from '../components/personal/NuevoIntegrante.vue'
import EditarIntegrante from '../components/personal/EditarIntegrante.vue'
import RolIntegrante from '../components/personal/RolIntegrante.vue'
import { confirmar } from '../composables/useDialogo'

const { usuario, esAdminOrg, puede } = useAuth()
const { buscar, cambiarEstado, reenviarInvitacion, quitar } = useStaff()
const { items: sucursales, cargar: cargarSucursales } = useBranches()
const { items: especialidades, cargar: cargarEspecialidades } = useSpecialties()
// Roles de permisos: solo el administrador los ve y asigna.
const { items: rolesPermisos, cargar: cargarRoles } = useRoles()

// ── Listado paginado (filtros en el servidor) ────────────────
const filtros = reactive({ q: '', estado: 'activos', especialidad: '', sucursal: '', clientes: false })
const pagina = ref(1)
const porPagina = ref(20)
const filas = ref([])
const total = ref(0)
const resumen = ref({ activos: 0, pendientes: 0, clientes: 0 })
const cargando = ref(false)
const error = ref('')
const aviso = ref('')

const totalPaginas = computed(() => Math.max(1, Math.ceil(total.value / porPagina.value)))
const rango = computed(() => {
  const desde = (pagina.value - 1) * porPagina.value
  return { desde: total.value ? desde + 1 : 0, hasta: Math.min(desde + porPagina.value, total.value) }
})

// Solo vale la última respuesta (si se filtra rápido, llegan desordenadas).
let solicitud = 0
async function cargarPagina() {
  const n = ++solicitud
  cargando.value = true
  error.value = ''
  try {
    const r = await buscar({
      pagina: pagina.value,
      porPagina: porPagina.value,
      estado: filtros.estado,
      ...(filtros.q.trim() && { q: filtros.q.trim() }),
      ...(filtros.especialidad && { especialidad: filtros.especialidad }),
      ...(filtros.sucursal && { sucursal: filtros.sucursal }),
      ...(filtros.clientes && { clientes: '1' }),
    })
    if (n !== solicitud) return
    // Si la página quedó vacía (p. ej. tras quitar al último), retrocede.
    if (!r.personal.length && pagina.value > 1 && r.total) {
      pagina.value = Math.ceil(r.total / porPagina.value)
      return cargarPagina()
    }
    filas.value = r.personal
    total.value = r.total
    resumen.value = r.resumen
  } catch (err) {
    if (n === solicitud) error.value = mensajeError(err)
  } finally {
    if (n === solicitud) cargando.value = false
  }
}

function irA(n) {
  pagina.value = Math.min(Math.max(1, n), totalPaginas.value)
  cargarPagina()
}

// Cualquier filtro vuelve a la primera página; la búsqueda espera a que se deje de escribir.
let temporizador
watch(
  () => filtros.q,
  () => {
    clearTimeout(temporizador)
    temporizador = setTimeout(() => irA(1), 300)
  }
)
watch(() => [filtros.estado, filtros.especialidad, filtros.sucursal, filtros.clientes, porPagina.value], () => irA(1))

onMounted(() =>
  Promise.all([cargarPagina(), cargarSucursales(), cargarEspecialidades(), esAdminOrg.value && cargarRoles()])
)
onBeforeUnmount(() => clearTimeout(temporizador))

const nombreSucursal = (id) => sucursales.value.find((s) => s.id === id)?.name ?? '—'
const nombreEspecialidad = (id) => especialidades.value.find((e) => e.id === id)?.name ?? ''
const nombreCompleto = (p) => [p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || 'Sin nombre'
const rolDe = (p) =>
  p.role === 'ORG_ADMIN' ? 'Administrador' : p.role === 'CLIENT' ? 'Cliente' : p.rol_nombre || 'Permisos básicos'

const iniciales = (p) =>
  (nombreCompleto(p) === 'Sin nombre' ? p.email : nombreCompleto(p))
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join('')

// ── Modales (nuevo / editar / rol) ───────────────────────────
const modal = ref(null) // { tipo: 'nuevo' | 'editar' | 'rol', integrante? }

function abrir(tipo, integrante = null) {
  cerrarMenu()
  aviso.value = ''
  modal.value = { tipo, integrante }
}

function alGuardar(mensaje) {
  modal.value = null
  aviso.value = mensaje
  cargarPagina()
}

// ── Menú de acciones por fila ────────────────────────────────
// Se dibuja fijo sobre la página para que la tabla (con scroll) no lo recorte.
const menu = ref(null) // { p, estilo }

// Quien no es admin no puede modificar a un administrador.
const modificable = (p) => esAdminOrg.value || p.role !== 'ORG_ADMIN'
const esYo = (p) => p.id === usuario.value?.id

function accionesDe(p) {
  const lista = []
  if (puede('personal.editar') && p.role !== 'CLIENT' && modificable(p)) {
    lista.push({ texto: 'Editar datos', fn: () => abrir('editar', p) })
  }
  if (esAdminOrg.value && !esYo(p)) {
    lista.push({ texto: p.role === 'CLIENT' ? 'Asignar rol (pasar a personal)' : 'Modificar rol', fn: () => abrir('rol', p) })
  }
  if (p.invitacion_pendiente && p.activo && puede('personal.crear')) {
    lista.push({ texto: 'Reenviar invitación', fn: () => reenviar(p) })
  }
  if (!esYo(p) && modificable(p)) {
    if (puede('personal.editar')) lista.push({ texto: p.activo ? 'Desactivar' : 'Reactivar', fn: () => alternarEstado(p) })
    if (puede('personal.eliminar')) lista.push({ texto: 'Quitar de la entidad', fn: () => quitarDeEntidad(p), peligro: true })
  }
  return lista
}

function abrirMenu(p, evento) {
  if (menu.value?.p.id === p.id) return cerrarMenu()
  const r = evento.currentTarget.getBoundingClientRect()
  const haciaArriba = r.bottom + 240 > window.innerHeight
  menu.value = {
    p,
    acciones: accionesDe(p),
    estilo: {
      right: `${window.innerWidth - r.right}px`,
      ...(haciaArriba ? { bottom: `${window.innerHeight - r.top + 4}px` } : { top: `${r.bottom + 4}px` }),
    },
  }
}

function cerrarMenu() {
  menu.value = null
}

function ejecutar(accion) {
  cerrarMenu()
  accion.fn()
}

const alClicFuera = (e) => {
  if (menu.value && !e.target.closest('.menu-acciones, .boton-acciones')) cerrarMenu()
}
const alTecla = (e) => e.key === 'Escape' && cerrarMenu()
onMounted(() => {
  document.addEventListener('click', alClicFuera)
  document.addEventListener('keydown', alTecla)
  window.addEventListener('scroll', cerrarMenu, true)
  window.addEventListener('resize', cerrarMenu)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', alClicFuera)
  document.removeEventListener('keydown', alTecla)
  window.removeEventListener('scroll', cerrarMenu, true)
  window.removeEventListener('resize', cerrarMenu)
})

// ── Acciones directas ────────────────────────────────────────
const ocupado = ref('')

async function accion(p, fn, exito) {
  ocupado.value = p.id
  aviso.value = ''
  error.value = ''
  try {
    await fn()
    aviso.value = exito
    await cargarPagina()
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    ocupado.value = ''
  }
}

const alternarEstado = async (p) => {
  const mensaje = `¿Desactivar a ${nombreCompleto(p)}? Perderá el acceso de inmediato.`
  if (p.activo && !(await confirmar({ titulo: 'Desactivar cuenta', mensaje, aceptar: 'Desactivar', peligro: true }))) return
  accion(p, () => cambiarEstado(p.id, !p.activo), p.activo ? 'Cuenta desactivada' : 'Cuenta reactivada')
}

const reenviar = (p) => accion(p, () => reenviarInvitacion(p.id), `Invitación reenviada a ${p.email}`)

const quitarDeEntidad = async (p) => {
  const mensaje = `¿Quitar a ${nombreCompleto(p)} de la entidad? Se borrarán sus sucursales y horarios. Su cuenta seguirá existiendo.`
  if (!(await confirmar({ titulo: 'Quitar de la entidad', mensaje, aceptar: 'Quitar', peligro: true }))) return
  accion(p, () => quitar(p.id), 'Integrante quitado de la entidad')
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <div>
        <h1>Personal</h1>
        <small class="suave">
          {{ resumen.activos }} activos
          <template v-if="resumen.pendientes"> · {{ resumen.pendientes }} con invitación pendiente</template>
        </small>
      </div>
      <button v-if="puede('personal.crear')" @click="abrir('nuevo')">+ Nuevo integrante</button>
    </div>

    <!-- Filtros -->
    <div class="filtros">
      <label style="flex: 1; min-width: 200px">
        Buscar
        <input v-model="filtros.q" type="search" placeholder="Nombre, apellido, RUT, email o teléfono" />
      </label>
      <label>
        Estado
        <select v-model="filtros.estado">
          <option value="activos">Activos</option>
          <option value="pendientes">Invitación pendiente</option>
          <option value="inactivos">Desactivados</option>
          <option value="todos">Todos</option>
        </select>
      </label>
      <label v-if="especialidades.length">
        Especialidad
        <select v-model="filtros.especialidad">
          <option value="">Todas</option>
          <option v-for="e in especialidades" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select>
      </label>
      <label v-if="sucursales.length">
        Sucursal
        <select v-model="filtros.sucursal">
          <option value="">Todas</option>
          <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label v-if="resumen.clientes" class="check">
        <input v-model="filtros.clientes" type="checkbox" />
        Incluir clientes ({{ resumen.clientes }})
      </label>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="aviso" class="suave" role="status">{{ aviso }}</p>

    <!-- Listado -->
    <section class="panel tabla-contenedor">
      <p v-if="cargando && !filas.length" class="vacio">Cargando…</p>
      <p v-else-if="!filas.length" class="vacio">No hay integrantes con estos filtros.</p>
      <table v-else class="tabla" :style="{ opacity: cargando ? 0.6 : 1 }">
        <thead>
          <tr>
            <th>Integrante</th>
            <th>RUT</th>
            <th>Especialidades</th>
            <th>Rol</th>
            <th>Sucursales</th>
            <th>Estado</th>
            <th class="col-acciones">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in filas" :key="p.id" :style="{ opacity: ocupado === p.id ? 0.5 : p.activo ? 1 : 0.6 }">
            <td>
              <div class="persona">
                <img v-if="p.avatar_url" :src="p.avatar_url" alt="" referrerpolicy="no-referrer" />
                <span v-else class="avatar">{{ iniciales(p) }}</span>
                <div>
                  <strong>{{ nombreCompleto(p) }}</strong>
                  <span v-if="esYo(p)" class="suave"> (tú)</span>
                  <div><small class="suave">{{ [p.email, p.phone].filter(Boolean).join(' · ') }}</small></div>
                </div>
              </div>
            </td>
            <td class="nowrap">{{ p.rut ? formatearRut(p.rut) : '—' }}</td>
            <td>
              <div v-if="p.specialty_ids.length" class="chips">
                <span v-for="id in p.specialty_ids" :key="id" class="chip">{{ nombreEspecialidad(id) }}</span>
              </div>
              <span v-else class="suave">—</span>
            </td>
            <td>
              <span class="chip" :class="{ gris: p.role === 'CLIENT' }">{{ rolDe(p) }}</span>
            </td>
            <td>
              <div v-if="p.branch_ids.length" class="chips">
                <span v-for="b in p.branch_ids" :key="b" class="chip gris">{{ nombreSucursal(b) }}</span>
              </div>
              <span v-else class="suave">—</span>
            </td>
            <td>
              <span v-if="!p.activo" class="chip gris">Desactivado</span>
              <span v-else-if="p.invitacion_pendiente" class="chip pendiente">Invitación pendiente</span>
              <span v-else class="chip activo">Activo</span>
            </td>
            <td class="col-acciones">
              <button
                v-if="accionesDe(p).length"
                class="secundario pequeno boton-acciones"
                aria-haspopup="menu"
                :aria-expanded="menu?.p.id === p.id"
                :disabled="ocupado === p.id"
                @click="abrirMenu(p, $event)"
              >
                Acciones ▾
              </button>
              <span v-else class="suave">—</span>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Paginación -->
      <div v-if="total" class="paginacion">
        <small class="suave">Mostrando {{ rango.desde }}–{{ rango.hasta }} de {{ total }}</small>
        <div class="acciones">
          <label class="check">
            Por página
            <select v-model.number="porPagina">
              <option :value="10">10</option>
              <option :value="20">20</option>
              <option :value="50">50</option>
            </select>
          </label>
          <button class="secundario pequeno" :disabled="pagina <= 1 || cargando" @click="irA(pagina - 1)">‹ Anterior</button>
          <small>Página {{ pagina }} de {{ totalPaginas }}</small>
          <button class="secundario pequeno" :disabled="pagina >= totalPaginas || cargando" @click="irA(pagina + 1)">
            Siguiente ›
          </button>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="menu" class="menu-acciones" role="menu" :style="menu.estilo">
        <button
          v-for="a in menu.acciones"
          :key="a.texto"
          type="button"
          role="menuitem"
          :class="{ peligro: a.peligro }"
          @click="ejecutar(a)"
        >
          {{ a.texto }}
        </button>
      </div>
    </Teleport>

    <NuevoIntegrante
      v-if="modal?.tipo === 'nuevo'"
      :especialidades="especialidades"
      :sucursales="sucursales"
      @cerrar="modal = null"
      @creado="alGuardar"
    />
    <EditarIntegrante
      v-if="modal?.tipo === 'editar'"
      :integrante="modal.integrante"
      :especialidades="especialidades"
      :sucursales="sucursales"
      @cerrar="modal = null"
      @guardado="alGuardar"
    />
    <RolIntegrante
      v-if="modal?.tipo === 'rol'"
      :integrante="modal.integrante"
      :roles="rolesPermisos"
      @cerrar="modal = null"
      @guardado="alGuardar"
    />
  </main>
</template>

<style scoped>
.persona {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.persona img,
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex: none;
}
.avatar {
  display: grid;
  place-items: center;
  font-size: 0.8rem;
  font-weight: 700;
  background: var(--acento-bg);
  color: var(--acento);
}
.nowrap {
  white-space: nowrap;
}
.tabla .col-acciones {
  text-align: right;
  white-space: nowrap;
}
.chip.activo {
  background: color-mix(in srgb, var(--ok) 15%, transparent);
  color: var(--ok);
}
.chip.pendiente {
  background: color-mix(in srgb, var(--aviso) 18%, transparent);
  color: var(--aviso);
}
.paginacion {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 12px;
}
.menu-acciones {
  position: fixed;
  z-index: 50;
  min-width: 220px;
  display: grid;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--superficie);
  box-shadow: var(--sombra);
}
.menu-acciones button {
  text-align: left;
  background: none;
  color: var(--text-h);
  padding: 8px 12px;
  border-radius: 6px;
}
.menu-acciones button:hover:not(:disabled) {
  background: var(--acento-bg);
}
.menu-acciones button.peligro {
  border: 0;
  color: var(--peligro);
}
.menu-acciones button.peligro:hover:not(:disabled) {
  background: color-mix(in srgb, var(--peligro) 12%, transparent);
  color: var(--peligro);
}
</style>
