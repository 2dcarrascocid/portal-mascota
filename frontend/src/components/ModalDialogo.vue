<script setup>
import { onMounted, ref } from 'vue'

// Ventana modal sobre <dialog> nativo (foco atrapado y Esc incluidos).
// Se monta abierta: el padre la muestra con v-if y la quita al recibir `cerrar`.
defineProps({ titulo: { type: String, required: true }, ancho: { type: String, default: '560px' } })
const emit = defineEmits(['cerrar'])
const dialogo = ref(null)

onMounted(() => dialogo.value.showModal())

// Clic en el fondo (fuera de la caja) cierra.
function alClic(e) {
  if (e.target === dialogo.value) emit('cerrar')
}
</script>

<template>
  <dialog ref="dialogo" class="modal" :style="{ '--ancho': ancho }" @cancel.prevent="emit('cerrar')" @click="alClic">
    <div class="caja">
      <header>
        <h2>{{ titulo }}</h2>
        <button type="button" class="cerrar" aria-label="Cerrar" @click="emit('cerrar')">×</button>
      </header>
      <slot />
    </div>
  </dialog>
</template>

<style scoped>
.modal {
  width: min(100% - 32px, var(--ancho));
  max-height: calc(100vh - 48px);
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radio);
  background: var(--superficie);
  color: var(--text);
  box-shadow: var(--sombra);
}
.modal::backdrop {
  background: rgba(0, 0, 0, 0.45);
}
.caja {
  padding: 16px 20px 20px;
  display: grid;
  gap: 12px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  margin: 0;
  font-size: 1.1rem;
}
.cerrar {
  padding: 0 8px;
  background: none;
  color: var(--text-suave);
  font-size: 1.5rem;
  line-height: 1;
}
.cerrar:hover:not(:disabled) {
  background: var(--acento-bg);
}
</style>
