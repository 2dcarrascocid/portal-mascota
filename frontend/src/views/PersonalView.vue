<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useBranches } from '../composables/useBranches'
import { useSpecialties } from '../composables/useSpecialties'
import { useStaff } from '../composables/useStaff'
import { CATEGORIAS_SERVICIO, ROLES, ROLES_PERSONAL } from '../lib/catalogos'
import { mensajeError } from '../services/api'

const { usuario } = useAuth()
const { personal, cargando, error, cargar, crear, actualizar, asignarSucursales, cambiarEstado, reenviarInvitacion, quitar } =
  useStaff()
const { items: sucursales, cargar: cargarSucursales } = useBranches()
const { items: especialidades, cargar: cargarEspecialidades } = useSpecialties()

onMounted(() => Promise.all([cargar(), cargarSucursales(), cargarEspecialidades()]))

// ── Filtros ──────────────────────────────────────────────────
const busqueda = ref('')
const filtroRol = ref('')
const filtroEstado = ref('activos') // activos | pendientes | inactivos | todos
const filtroSucursal = ref('')
const filtroEspecialidad = ref('')
const incluirClientes = ref(false)

const estado = (p) => (!p.activo ? 'inactivo' : p.invitacion_pendiente ? 'pendiente' : 'activo')

const visibles = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  return personal.value.filter((p) => {
    if (!incluirClientes.value && !ROLES_PERSONAL.includes(p.role)) return false
    if (filtroRol.value && p.role !== filtroRol.value) return false
    if (filtroSucursal.value && !p.branch_ids.includes(filtroSucursal.value)) return false
    if (filtroEspecialidad.value && !p.specialty_ids.includes(filtroEspecialidad.value)) return false
    const e = estado(p)
    if (filtroEstado.value === 'activos' && e === 'inactivo') return false
    if (filtroEstado.value === 'pendientes' && e !== 'pendiente') return false
    if (filtroEstado.value === 'inactivos' && e !== 'inactivo') return false
    const textos = [p.full_name, p.email, p.phone, ...p.specialty_ids.map(nombreEspecialidad)]
    if (q && !textos.some((x) => x?.toLowerCase().includes(q))) return false
    return true
  })
})

const resumen = computed(() => {
  const staff = personal.value.filter((p) => ROLES_PERSONAL.includes(p.role))
  return {
    total: staff.filter((p) => p.activo).length,
    pendientes: staff.filter((p) => p.activo && p.invitacion_pendiente).length,
    clientes: personal.value.filter((p) => p.role === 'CLIENT').length,
  }
})

const nombreSucursal = (id) => sucursales.value.find((s) => s.id === id)?.name ?? '—'
const nombreEspecialidad = (id) => especialidades.value.find((e) => e.id === id)?.name ?? ''

// Área de especialidades que corresponde a cada rol (el admin ve todas).
const AREA_ROL = { VET: 'VET', GROOMER: 'GROOMING', TRAINER: 'TRAINING' }
const iniciales = (p) =>
  (p.full_name || p.email)
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join('')

// ── Formulario (crear / editar) ──────────────────────────────
const vacio = () => ({ full_name: '', email: '', phone: '', role: 'VET', specialtyIds: [], branchIds: [] })
const form = reactive(vacio())
const editando = ref(null) // integrante en edición, o null para crear
const mostrarForm = ref(false)
const errorForm = ref('')
const guardando = ref(false)
const aviso = ref('')

const esYo = computed(() => editando.value?.id === usuario.value?.id)
// Al editar un cliente se puede promover; al crear, solo roles de personal.
// Especialidades ofrecidas: activas, generales o del área del rol, más las que
// ya tiene asignadas (para no perderlas en silencio).
const especialidadesDelRol = computed(() => {
  const areaRol = AREA_ROL[form.role]
  return especialidades.value.filter(
    (e) =>
      form.specialtyIds.includes(e.id) || (e.is_active && (!areaRol || !e.category || e.category === areaRol))
  )
})

const rolesDisponibles = computed(() =>
  editando.value?.role === 'CLIENT' ? [...ROLES_PERSONAL, 'CLIENT'] : ROLES_PERSONAL
)

function nuevo() {
  Object.assign(form, vacio())
  editando.value = null
  errorForm.value = ''
  mostrarForm.value = true
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function editar(p) {
  Object.assign(form, {
    full_name: p.full_name ?? '',
    email: p.email,
    phone: p.phone ?? '',
    role: p.role,
    specialtyIds: [...p.specialty_ids],
    branchIds: [...p.branch_ids],
  })
  editando.value = p
  errorForm.value = ''
  mostrarForm.value = true
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

const mismasSucursales = (a, b) => a.length === b.length && a.every((x) => b.includes(x))

async function guardar() {
  errorForm.value = ''
  aviso.value = ''
  guardando.value = true
  try {
    if (!editando.value) {
      const r = await crear({ ...form })
      aviso.value = r.cuentaExistente
        ? `${form.email} ya tenía cuenta: quedó agregado a tu entidad${r.correoEnviado ? ' y le avisamos por correo' : ''}.`
        : r.correoEnviado
          ? `Invitación enviada a ${form.email}. Tiene 3 días para crear su contraseña.`
          : 'Cuenta creada, pero no se pudo enviar el correo. Usa "Reenviar invitación".'
    } else {
      const p = editando.value
      await actualizar(p.id, {
        full_name: form.full_name,
        phone: form.phone,
        role: form.role,
        specialtyIds: form.specialtyIds,
      })
      if (ROLES_PERSONAL.includes(form.role) && !mismasSucursales(form.branchIds, p.branch_ids)) {
        const quitadas = p.branch_ids.filter((b) => !form.branchIds.includes(b))
        if (!quitadas.length || confirm('Al quitar sucursales se borran los horarios de esta persona en ellas. ¿Continuar?')) {
          await asignarSucursales(p.id, form.branchIds)
        }
      }
      aviso.value = 'Cambios guardados'
    }
    mostrarForm.value = false
  } catch (err) {
    errorForm.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}

// ── Acciones de fila ─────────────────────────────────────────
const ocupado = ref('')

async function accion(p, fn, exito) {
  ocupado.value = p.id
  aviso.value = ''
  error.value = ''
  try {
    await fn()
    if (exito) aviso.value = exito
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    ocupado.value = ''
  }
}

const alternarEstado = (p) => {
  if (p.activo && !confirm(`¿Desactivar a ${p.full_name || p.email}? Perderá el acceso de inmediato.`)) return
  accion(p, () => cambiarEstado(p.id, !p.activo), p.activo ? 'Cuenta desactivada' : 'Cuenta reactivada')
}

const reenviar = (p) => accion(p, () => reenviarInvitacion(p.id), `Invitación reenviada a ${p.email}`)

const quitarDeEntidad = (p) => {
  if (!confirm(`¿Quitar a ${p.full_name || p.email} de la entidad? Se borrarán sus sucursales y horarios. Su cuenta seguirá existiendo.`)) return
  accion(p, () => quitar(p.id), 'Integrante quitado de la entidad')
}
</script>

<template>
  <main class="contenedor pagina">
    <div class="pagina-cabecera">
      <div>
        <h1>Personal</h1>
        <small class="suave">
          {{ resumen.total }} activos
          <template v-if="resumen.pendientes"> · {{ resumen.pendientes }} con invitación pendiente</template>
        </small>
      </div>
      <button v-if="!mostrarForm" @click="nuevo">+ Nuevo integrante</button>
    </div>

    <!-- Formulario -->
    <form v-if="mostrarForm" class="panel" @submit.prevent="guardar">
      <h2>{{ editando ? `Editar a ${editando.full_name || editando.email}` : 'Nuevo integrante' }}</h2>
      <p v-if="!editando" class="suave" style="margin-top: 0">
        Le enviaremos un correo para que cree su contraseña. Si ya tiene cuenta en Portal Animal, solo se sumará a tu
        entidad.
      </p>
      <div class="grilla-form">
        <label>Nombre completo <input v-model="form.full_name" required maxlength="120" /></label>
        <label>
          Email
          <input v-model="form.email" type="email" required :disabled="!!editando" autocomplete="off" />
        </label>
        <label>Teléfono <input v-model="form.phone" type="tel" maxlength="40" /></label>
        <label>
          Rol
          <select v-model="form.role" required :disabled="esYo">
            <option v-for="r in rolesDisponibles" :key="r" :value="r">{{ ROLES[r] }}</option>
          </select>
          <small v-if="esYo" class="suave">No puedes cambiar tu propio rol.</small>
        </label>
        <div v-if="ROLES_PERSONAL.includes(form.role)" class="campo ancho-completo">
          Especialidades
          <div v-if="especialidadesDelRol.length" class="chips">
            <label v-for="e in especialidadesDelRol" :key="e.id" class="check">
              <input v-model="form.specialtyIds" type="checkbox" :value="e.id" />
              {{ e.name }}
              <small v-if="e.category" class="suave">· {{ CATEGORIAS_SERVICIO[e.category] }}</small>
            </label>
          </div>
          <small class="suave">
            {{ especialidadesDelRol.length ? '' : 'No hay especialidades para este rol. ' }}
            <RouterLink to="/especialidades">Administrar especialidades</RouterLink>
          </small>
        </div>
        <div v-if="ROLES_PERSONAL.includes(form.role)" class="campo ancho-completo">
          Sucursales donde atiende
          <div v-if="sucursales.length" class="chips">
            <label v-for="s in sucursales" :key="s.id" class="check">
              <input v-model="form.branchIds" type="checkbox" :value="s.id" />
              {{ s.name }}
            </label>
          </div>
          <small v-else class="suave">Aún no hay sucursales. Puedes asignarlas después.</small>
        </div>
      </div>
      <p v-if="errorForm" class="error" role="alert">{{ errorForm }}</p>
      <div class="acciones">
        <button :disabled="guardando">
          {{ guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear e invitar' }}
        </button>
        <button type="button" class="secundario" @click="mostrarForm = false">Cancelar</button>
      </div>
    </form>

    <!-- Filtros -->
    <div class="filtros">
      <label style="flex: 1; min-width: 200px">
        Buscar
        <input v-model="busqueda" type="search" placeholder="Nombre, email, teléfono o especialidad" />
      </label>
      <label>
        Rol
        <select v-model="filtroRol">
          <option value="">Todos</option>
          <option v-for="r in incluirClientes ? [...ROLES_PERSONAL, 'CLIENT'] : ROLES_PERSONAL" :key="r" :value="r">
            {{ ROLES[r] }}
          </option>
        </select>
      </label>
      <label>
        Estado
        <select v-model="filtroEstado">
          <option value="activos">Activos</option>
          <option value="pendientes">Invitación pendiente</option>
          <option value="inactivos">Desactivados</option>
          <option value="todos">Todos</option>
        </select>
      </label>
      <label v-if="especialidades.length">
        Especialidad
        <select v-model="filtroEspecialidad">
          <option value="">Todas</option>
          <option v-for="e in especialidades" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select>
      </label>
      <label v-if="sucursales.length">
        Sucursal
        <select v-model="filtroSucursal">
          <option value="">Todas</option>
          <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label v-if="resumen.clientes" class="check">
        <input v-model="incluirClientes" type="checkbox" />
        Incluir clientes ({{ resumen.clientes }})
      </label>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="aviso" class="suave" role="status">{{ aviso }}</p>

    <!-- Listado -->
    <section class="panel tabla-contenedor">
      <p v-if="cargando" class="vacio">Cargando…</p>
      <p v-else-if="!visibles.length" class="vacio">No hay integrantes con estos filtros.</p>
      <table v-else class="tabla">
        <thead>
          <tr>
            <th>Integrante</th>
            <th>Rol</th>
            <th>Sucursales</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in visibles" :key="p.id" :style="{ opacity: ocupado === p.id ? 0.5 : p.activo ? 1 : 0.6 }">
            <td>
              <div class="persona">
                <img v-if="p.avatar_url" :src="p.avatar_url" alt="" referrerpolicy="no-referrer" />
                <span v-else class="avatar">{{ iniciales(p) }}</span>
                <div>
                  <strong>{{ p.full_name || 'Sin nombre' }}</strong>
                  <span v-if="p.id === usuario?.id" class="suave"> (tú)</span>
                  <div><small class="suave">{{ [p.email, p.phone].filter(Boolean).join(' · ') }}</small></div>
                  <div v-if="p.specialty_ids.length" class="chips" style="margin-top: 4px">
                    <span v-for="id in p.specialty_ids" :key="id" class="chip">{{ nombreEspecialidad(id) }}</span>
                  </div>
                </div>
              </div>
            </td>
            <td><span class="chip" :class="{ gris: p.role === 'CLIENT' }">{{ ROLES[p.role] }}</span></td>
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
            <td>
              <div class="acciones">
                <button class="secundario pequeno" :disabled="ocupado === p.id" @click="editar(p)">
                  {{ p.role === 'CLIENT' ? 'Promover' : 'Editar' }}
                </button>
                <button
                  v-if="p.invitacion_pendiente && p.activo"
                  class="secundario pequeno"
                  :disabled="ocupado === p.id"
                  @click="reenviar(p)"
                >
                  Reenviar invitación
                </button>
                <template v-if="p.id !== usuario?.id">
                  <button class="secundario pequeno" :disabled="ocupado === p.id" @click="alternarEstado(p)">
                    {{ p.activo ? 'Desactivar' : 'Reactivar' }}
                  </button>
                  <button class="peligro pequeno" :disabled="ocupado === p.id" @click="quitarDeEntidad(p)">Quitar</button>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
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
.chip.activo {
  background: color-mix(in srgb, var(--ok) 15%, transparent);
  color: var(--ok);
}
.chip.pendiente {
  background: color-mix(in srgb, var(--aviso) 18%, transparent);
  color: var(--aviso);
}
</style>
