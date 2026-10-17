<script setup>
import { reactive, ref } from 'vue'
import { useStaff } from '../../composables/useStaff'
import { rutValido } from '../../lib/rut'
import { mensajeError } from '../../services/api'
import ModalDialogo from '../ModalDialogo.vue'
import CamposIntegrante from './CamposIntegrante.vue'

// Alta de un integrante: crea la cuenta e invita por correo. Entra con
// permisos básicos; el rol se asigna después con RolIntegrante.
defineProps({
  especialidades: { type: Array, default: () => [] },
  sucursales: { type: Array, default: () => [] },
})
// creado: mensaje para mostrar en el listado.
const emit = defineEmits(['cerrar', 'creado'])
const { crear } = useStaff()

const form = reactive({ first_name: '', last_name: '', rut: '', email: '', phone: '', specialtyIds: [], branchIds: [] })
const error = ref('')
const guardando = ref(false)

async function guardar() {
  error.value = ''
  if (!rutValido(form.rut)) {
    error.value = 'RUT inválido: revisa el número y el dígito verificador.'
    return
  }
  guardando.value = true
  try {
    const r = await crear({ ...form })
    emit(
      'creado',
      r.cuentaExistente
        ? `${form.email} ya tenía cuenta: quedó agregado a tu entidad${r.correoEnviado ? ' y le avisamos por correo' : ''}.`
        : r.correoEnviado
          ? `Invitación enviada a ${form.email}. Tiene 3 días para crear su contraseña.`
          : 'Cuenta creada, pero no se pudo enviar el correo. Usa "Reenviar invitación".'
    )
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalDialogo titulo="Nuevo integrante" ancho="640px" @cerrar="emit('cerrar')">
    <form class="pagina" @submit.prevent="guardar">
      <p class="suave" style="margin: 0">
        Le enviaremos un correo para que cree su contraseña. Si ya tiene cuenta en Portal Animal, solo se sumará a tu
        entidad. Entra con permisos básicos; el rol se asigna después desde Acciones.
      </p>
      <CamposIntegrante v-model="form" :especialidades="especialidades" :sucursales="sucursales" />
      <p v-if="error" class="error" role="alert" style="margin: 0">{{ error }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Creando…' : 'Crear e invitar' }}</button>
        <button type="button" class="secundario" @click="emit('cerrar')">Cancelar</button>
      </div>
    </form>
  </ModalDialogo>
</template>
