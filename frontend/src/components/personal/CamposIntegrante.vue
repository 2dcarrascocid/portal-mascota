<script setup>
import { computed, ref } from 'vue'
import { formatearRut, rutValido } from '../../lib/rut'

// Campos de un integrante, compartidos por NuevoIntegrante y EditarIntegrante.
// form: { first_name, last_name, rut, email, phone, specialtyIds, branchIds }
const form = defineModel({ type: Object, required: true })
const props = defineProps({
  especialidades: { type: Array, default: () => [] },
  sucursales: { type: Array, default: () => [] },
  emailBloqueado: { type: Boolean, default: false },
  sucursalesBloqueadas: { type: Boolean, default: false },
})

const rutTocado = ref(false)
const errorRut = computed(() => rutTocado.value && form.value.rut && !rutValido(form.value.rut))

function salirRut() {
  rutTocado.value = true
  form.value.rut = formatearRut(form.value.rut.trim())
}

// Activas, más las que ya tiene asignadas (para no perderlas en silencio).
const especialidadesVisibles = computed(() =>
  props.especialidades.filter((e) => e.is_active || form.value.specialtyIds.includes(e.id))
)
</script>

<template>
  <div class="grilla-form">
    <label>Nombres <input v-model="form.first_name" required maxlength="80" autocomplete="off" /></label>
    <label>Apellidos <input v-model="form.last_name" required maxlength="80" autocomplete="off" /></label>
    <label>
      RUT
      <input
        v-model="form.rut"
        required
        maxlength="12"
        placeholder="12.345.678-9"
        autocomplete="off"
        :aria-invalid="errorRut || undefined"
        @blur="salirRut"
      />
      <small v-if="errorRut" class="error">RUT inválido</small>
    </label>
    <label>
      Email
      <input v-model="form.email" type="email" required :disabled="emailBloqueado" autocomplete="off" />
    </label>
    <label>Teléfono <input v-model="form.phone" type="tel" maxlength="40" /></label>

    <div class="campo ancho-completo">
      Especialidades
      <div v-if="especialidadesVisibles.length" class="chips">
        <label v-for="e in especialidadesVisibles" :key="e.id" class="check">
          <input v-model="form.specialtyIds" type="checkbox" :value="e.id" />
          {{ e.name }}
        </label>
      </div>
      <small class="suave">
        {{ especialidadesVisibles.length ? '' : 'Aún no hay especialidades. ' }}
        <RouterLink :to="{ name: 'config-especialidades' }">Administrar especialidades</RouterLink>
      </small>
    </div>

    <div class="campo ancho-completo">
      Sucursales donde atiende
      <div v-if="sucursales.length" class="chips">
        <label v-for="s in sucursales" :key="s.id" class="check">
          <input v-model="form.branchIds" type="checkbox" :value="s.id" :disabled="sucursalesBloqueadas" />
          {{ s.name }}
        </label>
      </div>
      <small v-if="sucursalesBloqueadas" class="suave">Tus sucursales las asigna un administrador.</small>
      <small v-else-if="!sucursales.length" class="suave">Aún no hay sucursales. Puedes asignarlas después.</small>
    </div>
  </div>
</template>
