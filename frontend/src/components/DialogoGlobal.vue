<script setup>
import { ref, watch } from 'vue'
import ModalDialogo from './ModalDialogo.vue'
import { useDialogo } from '../composables/useDialogo'

// Único componente que muestra las confirmaciones, avisos y pedidos de
// texto de toda la app (ver composables/useDialogo.js). Va montado una sola
// vez en App.vue; se abre encima de cualquier otro modal.
const { actual, responder } = useDialogo()
const texto = ref('')

watch(actual, (d) => {
  texto.value = d?.tipo === 'texto' ? (d.valor ?? '') : ''
})

function aceptar() {
  const d = actual.value
  if (d.tipo === 'confirmar') return responder(true)
  if (d.tipo === 'texto') return responder(texto.value.trim())
  responder()
}
</script>

<template>
  <ModalDialogo
    v-if="actual"
    :key="actual.id"
    :titulo="actual.titulo || (actual.tipo === 'aviso' ? 'Aviso' : 'Confirmar')"
    ancho="460px"
    @cerrar="responder()"
  >
    <form class="dialogo" @submit.prevent="aceptar">
      <p v-if="actual.mensaje" class="mensaje">{{ actual.mensaje }}</p>
      <ul v-if="actual.detalle?.length" class="detalle">
        <li v-for="(linea, i) in actual.detalle" :key="i">{{ linea }}</li>
      </ul>

      <label v-if="actual.tipo === 'texto'" class="campo">
        {{ actual.etiqueta }}
        <textarea
          v-model="texto"
          rows="3"
          :maxlength="actual.max || 300"
          :required="actual.requerido"
          :placeholder="actual.placeholder"
          autofocus
        ></textarea>
      </label>

      <div class="acciones botones">
        <button v-if="actual.tipo !== 'aviso'" type="button" class="secundario" @click="responder()">
          {{ actual.cancelar || 'Cancelar' }}
        </button>
        <button :class="{ peligro: actual.peligro }" :autofocus="actual.tipo !== 'texto'">
          {{ actual.aceptar || (actual.tipo === 'aviso' ? 'Entendido' : 'Aceptar') }}
        </button>
      </div>
    </form>
  </ModalDialogo>
</template>

<style scoped>
.dialogo {
  display: grid;
  gap: 12px;
}
.mensaje {
  margin: 0;
  white-space: pre-line;
}
.detalle {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 4px;
  color: var(--text-suave);
  font-size: 0.92rem;
}
.botones {
  justify-content: flex-end;
}
/* En el diálogo, el botón de peligro va relleno: es la acción principal. */
button.peligro {
  background: var(--peligro);
  color: #fff;
}
</style>
