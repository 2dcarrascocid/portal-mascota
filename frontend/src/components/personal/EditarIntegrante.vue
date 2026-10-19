<script setup>
import { computed, reactive, ref } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useStaff } from '../../composables/useStaff'
import { formatearRut, rutValido } from '../../lib/rut'
import { mensajeError } from '../../services/api'
import ModalDialogo from '../ModalDialogo.vue'
import CamposIntegrante from './CamposIntegrante.vue'
import { confirmar } from '../../composables/useDialogo'

// Edición de datos, especialidades y sucursales de un integrante.
// El rol se cambia aparte, con RolIntegrante.
const props = defineProps({
  integrante: { type: Object, required: true },
  especialidades: { type: Array, default: () => [] },
  sucursales: { type: Array, default: () => [] },
})
const emit = defineEmits(['cerrar', 'guardado'])
const { usuario, esAdminOrg } = useAuth()
const { actualizar, asignarSucursales } = useStaff()

const p = props.integrante
const form = reactive({
  first_name: p.first_name ?? '',
  last_name: p.last_name ?? '',
  rut: formatearRut(p.rut ?? ''),
  email: p.email,
  phone: p.phone ?? '',
  specialtyIds: [...p.specialty_ids],
  branchIds: [...p.branch_ids],
})
const error = ref('')
const guardando = ref(false)

// Quien no es admin no se asigna sucursales a sí mismo.
const sucursalesBloqueadas = computed(() => p.id === usuario.value?.id && !esAdminOrg.value)
const mismas = (a, b) => a.length === b.length && a.every((x) => b.includes(x))

async function guardar() {
  error.value = ''
  if (!rutValido(form.rut)) {
    error.value = 'RUT inválido: revisa el número y el dígito verificador.'
    return
  }
  const quitadas = p.branch_ids.filter((b) => !form.branchIds.includes(b))
  const cambiaSucursales = !sucursalesBloqueadas.value && !mismas(form.branchIds, p.branch_ids)
  if (
    cambiaSucursales &&
    quitadas.length &&
    !(await confirmar({
      titulo: 'Quitar sucursales',
      mensaje: 'Al quitar sucursales se borran los horarios de esta persona en ellas. ¿Continuar?',
      aceptar: 'Continuar',
      peligro: true,
    }))
  ) {
    return
  }
  guardando.value = true
  try {
    const { email, branchIds, ...datos } = form
    await actualizar(p.id, datos)
    if (cambiaSucursales) await asignarSucursales(p.id, branchIds)
    emit('guardado', 'Cambios guardados')
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalDialogo :titulo="`Editar a ${p.full_name || p.email}`" ancho="640px" @cerrar="emit('cerrar')">
    <form class="pagina" @submit.prevent="guardar">
      <CamposIntegrante
        v-model="form"
        email-bloqueado
        :especialidades="especialidades"
        :sucursales="sucursales"
        :sucursales-bloqueadas="sucursalesBloqueadas"
      />
      <p v-if="error" class="error" role="alert" style="margin: 0">{{ error }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar cambios' }}</button>
        <button type="button" class="secundario" @click="emit('cerrar')">Cancelar</button>
      </div>
    </form>
  </ModalDialogo>
</template>
