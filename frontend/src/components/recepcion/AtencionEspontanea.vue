<script setup>
import { computed, reactive, ref } from 'vue'
import ModalDialogo from '../ModalDialogo.vue'
import SelectorPaciente from '../citas/SelectorPaciente.vue'
import { atiendenEn, especialidadesDe, useReception } from '../../composables/useReception'
import { mensajeError } from '../../services/api'

// Llegada sin cita: con ficha (tutor + mascota registrados) o sin ficha
// (solo contacto y nombre de la mascota; se puede registrar después).
const props = defineProps({
  sucursales: { type: Array, required: true },
  personal: { type: Array, required: true },
  especialidades: { type: Array, required: true },
  branchId: { type: String, default: '' },
  busqueda: { type: String, default: '' }, // lo que se buscó en recepción
})
const emit = defineEmits(['cerrar', 'recibida'])

const { recibir } = useReception()

// Con lo buscado se precompleta el contacto: teléfono si son dígitos, si no el nombre.
const esTelefono = /^[\d\s+()-]{6,}$/.test(props.busqueda.trim())
const conFicha = ref(true)
const tutor = ref(null)
const mascota = ref('')
const form = reactive({
  branch_id: props.branchId || (props.sucursales.length === 1 ? props.sucursales[0].id : ''),
  staff_id: '',
  specialty_id: '',
  contact_name: esTelefono ? '' : props.busqueda.trim(),
  contact_phone: esTelefono ? props.busqueda.trim() : '',
  pet_name: '',
  observations: '',
})
const error = ref('')
const guardando = ref(false)

// Personal de la sucursal elegida (con especialidades), acotado por la especialidad.
const deLaSucursal = computed(() => (form.branch_id ? atiendenEn(props.personal, [form.branch_id]) : []))
const opcionesEspecialidad = computed(() => {
  const elegido = deLaSucursal.value.find((p) => p.id === form.staff_id)
  return especialidadesDe(elegido ? [elegido] : deLaSucursal.value, props.especialidades)
})
const opcionesProfesional = computed(() =>
  deLaSucursal.value.filter((p) => !form.specialty_id || p.specialty_ids.includes(form.specialty_id))
)
function cambiarSucursal(id) {
  form.branch_id = id
  form.staff_id = ''
  form.specialty_id = ''
}

async function guardar() {
  error.value = ''
  if (conFicha.value && !tutor.value) {
    error.value = 'Busca y elige el tutor, o marca «Sin ficha».'
    return
  }
  guardando.value = true
  try {
    const atencion = await recibir({
      branch_id: form.branch_id,
      staff_id: form.staff_id || null,
      specialty_id: form.specialty_id || null,
      observations: form.observations,
      ...(conFicha.value
        ? { client_id: tutor.value.id, pet_id: mascota.value || null }
        : { contact_name: form.contact_name, contact_phone: form.contact_phone, pet_name: form.pet_name }),
    })
    emit('recibida', atencion)
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalDialogo titulo="Atención espontánea (sin cita)" ancho="620px" @cerrar="emit('cerrar')">
    <form class="formulario" @submit.prevent="guardar">
      <div class="grilla-form">
        <label>
          Sucursal
          <select :value="form.branch_id" required @change="cambiarSucursal($event.target.value)">
            <option value="" disabled>Elegir…</option>
            <option v-for="s in sucursales" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label>
          Especialidad
          <select v-model="form.specialty_id" :disabled="!form.branch_id">
            <option value="">Sin indicar</option>
            <option v-for="e in opcionesEspecialidad" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
        </label>
        <label>
          Atiende
          <select v-model="form.staff_id" :disabled="!form.branch_id">
            <option value="">Sin asignar</option>
            <option v-for="p in opcionesProfesional" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
          </select>
          <small v-if="form.branch_id && !deLaSucursal.length" class="suave">
            No hay personal con especialidades asignado a esta sucursal.
          </small>
        </label>
      </div>

      <div class="acciones" role="radiogroup" aria-label="Ficha">
        <button type="button" class="pequeno" :class="{ secundario: !conFicha }" @click="conFicha = true">
          Con ficha
        </button>
        <button type="button" class="pequeno" :class="{ secundario: conFicha }" @click="conFicha = false">
          Sin ficha
        </button>
      </div>

      <SelectorPaciente v-if="conFicha" v-model:tutor="tutor" v-model:mascota="mascota" />
      <div v-else class="grilla-form">
        <label>Nombre del tutor <input v-model="form.contact_name" required maxlength="120" /></label>
        <label>Teléfono <input v-model="form.contact_phone" type="tel" maxlength="40" /></label>
        <label>Nombre de la mascota <input v-model="form.pet_name" maxlength="80" /></label>
      </div>

      <label>
        Motivo / observaciones
        <textarea v-model="form.observations" rows="2" maxlength="4000"></textarea>
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="acciones">
        <button :disabled="guardando">{{ guardando ? 'Guardando…' : 'Registrar llegada' }}</button>
        <button type="button" class="secundario" @click="emit('cerrar')">Cancelar</button>
      </div>
    </form>
  </ModalDialogo>
</template>
