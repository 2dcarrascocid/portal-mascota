<script setup>
import { computed } from 'vue'
import { useSpecies } from '../composables/useSpecies'

// Campos de una mascota. `modelValue` es un objeto reactivo que se edita en el lugar.
const mascota = defineModel({ type: Object, required: true })

const { especies, razasDe } = useSpecies()
const razas = computed(() => razasDe(mascota.value.species_id))
const hoy = new Date().toISOString().slice(0, 10)

// Al cambiar la especie, la raza elegida deja de ser válida.
function cambiarEspecie(id) {
  mascota.value.species_id = id
  mascota.value.breed_id = ''
}
</script>

<template>
  <div class="grilla-form">
    <label>Nombre <input v-model="mascota.name" required maxlength="80" /></label>
    <label>
      Especie
      <select :value="mascota.species_id" required @change="cambiarEspecie($event.target.value)">
        <option value="" disabled>Elegir…</option>
        <option v-for="e in especies" :key="e.id" :value="e.id">{{ e.name }}</option>
      </select>
    </label>
    <label>
      Raza
      <select v-model="mascota.breed_id" :disabled="!mascota.species_id">
        <option value="">Sin especificar</option>
        <option v-for="r in razas" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
    </label>
    <label>Nacimiento <input v-model="mascota.birth_date" type="date" :max="hoy" /></label>
    <label>Peso (kg) <input v-model="mascota.weight" type="number" min="0.01" step="0.01" /></label>
    <label>Microchip <input v-model="mascota.microchip_number" maxlength="40" /></label>
    <label class="ancho-completo">Notas <textarea v-model="mascota.notes" rows="2" maxlength="2000"></textarea></label>
  </div>
</template>
