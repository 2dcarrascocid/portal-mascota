<script setup>
import { computed, reactive, ref } from 'vue'
import { useAppointments } from '../../composables/useAppointments'
import { fechaCorta } from '../../lib/fechas'
import { mensajeError } from '../../services/api'
import SelectorPaciente from './SelectorPaciente.vue'

// Reserva de un turno elegido en la búsqueda.
//   Con ficha: tutor (y mascota) registrados.
//   Sin ficha: solo contacto; la ficha se puede vincular después.
const props = defineProps({
  turno: { type: Object, required: true }, // { fecha, inicio, fin, staff_id, branch_id }
  profesional: { type: Object, default: null },
  sucursal: { type: Object, default: null },
  servicios: { type: Array, default: () => [] }, // los que puede realizar el profesional
  servicioId: { type: String, default: '' },
  especialidadId: { type: String, default: '' },
})
const emit = defineEmits(['reservada', 'cancelar', 'ocupado'])

const { crear } = useAppointments()

const modo = ref('ficha') // 'ficha' | 'sin'
const tutor = ref(null)
const mascota = ref('')
const form = reactive({
  service_id: props.servicioId,
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  notes: '',
})
const error = ref('')
const guardando = ref(false)

const servicioElegido = computed(() => props.servicios.find((s) => s.id === form.service_id))
const minutos = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
// Aviso si el servicio no cabe en el turno (la cita ocupa un solo turno).
const excedeTurno = computed(
  () => !!servicioElegido.value && servicioElegido.value.duration_minutes > minutos(props.turno.fin) - minutos(props.turno.inicio)
)

async function reservar() {
  error.value = ''
  if (modo.value === 'ficha' && !tutor.value) {
    error.value = 'Elige el tutor, o cambia a "Sin ficha"'
    return
  }
  guardando.value = true
  try {
    const cita = await crear({
      staff_id: props.turno.staff_id,
      branch_id: props.turno.branch_id,
      date: props.turno.fecha,
      start_time: props.turno.inicio,
      service_id: form.service_id || null,
      specialty_id: props.especialidadId || null,
      notes: form.notes,
      ...(modo.value === 'ficha'
        ? { client_id: tutor.value.id, pet_id: mascota.value || null }
        : { contact_name: form.contact_name, contact_phone: form.contact_phone, contact_email: form.contact_email }),
    })
    emit('reservada', cita)
  } catch (err) {
    error.value = mensajeError(err)
    // El turno se tomó mientras tanto: hay que refrescar la búsqueda.
    if (err.response?.status === 409) emit('ocupado')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <form class="panel reserva" @submit.prevent="reservar">
    <h2>Reservar hora</h2>
    <p class="resumen">
      <strong>{{ fechaCorta(turno.fecha, { anio: true }) }} · {{ turno.inicio }}–{{ turno.fin }}</strong>
      <span>{{ profesional?.full_name || profesional?.email || 'Profesional' }}</span>
      <span class="suave">{{ sucursal?.name }}</span>
    </p>

    <div class="acciones" role="radiogroup" aria-label="Paciente">
      <label class="check"><input v-model="modo" type="radio" value="ficha" /> Con ficha (tutor / mascota)</label>
      <label class="check"><input v-model="modo" type="radio" value="sin" /> Sin ficha</label>
    </div>

    <div class="grilla-form">
      <SelectorPaciente v-if="modo === 'ficha'" v-model:tutor="tutor" v-model:mascota="mascota" class="ancho-completo" />
      <template v-else>
        <label>Nombre de contacto <input v-model="form.contact_name" required maxlength="120" /></label>
        <label>Teléfono <input v-model="form.contact_phone" type="tel" maxlength="40" /></label>
        <label>Email <input v-model="form.contact_email" type="email" /></label>
        <small class="suave ancho-completo">Podrás vincular la ficha del tutor y la mascota más adelante.</small>
      </template>

      <label>
        Servicio
        <select v-model="form.service_id">
          <option value="">Sin indicar</option>
          <option v-for="s in servicios" :key="s.id" :value="s.id">{{ s.name }} · {{ s.duration_minutes }} min</option>
        </select>
        <small v-if="excedeTurno" class="aviso">El servicio dura más que el turno.</small>
      </label>
      <label class="ancho-completo">
        Notas
        <textarea v-model="form.notes" rows="2" maxlength="1000" placeholder="Motivo de la consulta, indicaciones…"></textarea>
      </label>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="acciones">
      <button :disabled="guardando">{{ guardando ? 'Reservando…' : 'Reservar' }}</button>
      <button type="button" class="secundario" @click="emit('cancelar')">Cancelar</button>
    </div>
  </form>
</template>

<style scoped>
.reserva {
  border-color: var(--acento);
  display: grid;
  gap: 12px;
}
.reserva h2 {
  margin: 0;
}
.resumen {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 0;
}
.aviso {
  color: var(--aviso);
}
</style>
