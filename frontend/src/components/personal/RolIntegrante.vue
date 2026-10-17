<script setup>
import { ref } from 'vue'
import { useStaff } from '../../composables/useStaff'
import { mensajeError } from '../../services/api'
import ModalDialogo from '../ModalDialogo.vue'

// Asignación de rol (solo ORG_ADMIN): administrador con acceso total, o un
// rol de permisos ('' = permisos básicos). A un cliente lo convierte en personal.
const props = defineProps({
  integrante: { type: Object, required: true },
  roles: { type: Array, default: () => [] },
})
const emit = defineEmits(['cerrar', 'guardado'])
const { asignarRol } = useStaff()

const p = props.integrante
const ADMIN = 'admin'
const seleccion = ref(p.role === 'ORG_ADMIN' ? ADMIN : p.role === 'CLIENT' ? '' : (p.role_id ?? ''))
const error = ref('')
const guardando = ref(false)

async function guardar() {
  error.value = ''
  if (seleccion.value === ADMIN && p.role !== 'ORG_ADMIN' && !confirm(`¿Dar acceso total de administrador a ${p.full_name || p.email}?`)) {
    return
  }
  guardando.value = true
  try {
    const administrador = seleccion.value === ADMIN
    await asignarRol(p.id, { administrador, role_id: administrador ? null : seleccion.value || null })
    emit('guardado', 'Rol actualizado')
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalDialogo :titulo="`Rol de ${p.full_name || p.email}`" ancho="480px" @cerrar="emit('cerrar')">
    <form class="pagina" @submit.prevent="guardar">
      <p v-if="p.role === 'CLIENT'" class="suave" style="margin: 0">
        Hoy es cliente: al asignarle un rol pasa a ser parte del personal.
      </p>
      <fieldset class="opciones">
        <legend class="suave">Qué puede hacer en el sistema</legend>
        <label class="opcion">
          <input v-model="seleccion" type="radio" :value="ADMIN" />
          <span><strong>Administrador</strong><small class="suave">Acceso total, incluida la gestión de roles.</small></span>
        </label>
        <label class="opcion">
          <input v-model="seleccion" type="radio" value="" />
          <span><strong>Permisos básicos</strong><small class="suave">Consultar, agendar citas y registrar tutores.</small></span>
        </label>
        <label v-for="r in roles" :key="r.id" class="opcion">
          <input v-model="seleccion" type="radio" :value="r.id" />
          <span>
            <strong>{{ r.name }}</strong>
            <small v-if="r.description" class="suave">{{ r.description }}</small>
          </span>
        </label>
      </fieldset>
      <small class="suave">
        <RouterLink :to="{ name: 'config-roles' }">Administrar roles y permisos</RouterLink>
      </small>
      <p v-if="error" class="error" role="alert" style="margin: 0">{{ error }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar rol' }}</button>
        <button type="button" class="secundario" @click="emit('cerrar')">Cancelar</button>
      </div>
    </form>
  </ModalDialogo>
</template>

<style scoped>
.opciones {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.opciones legend {
  font-size: 0.9rem;
  margin-bottom: 4px;
}
.opcion {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
.opcion:has(input:checked) {
  border-color: var(--acento);
  background: var(--acento-bg);
}
.opcion input {
  margin-top: 4px;
}
.opcion span {
  display: grid;
}
</style>
