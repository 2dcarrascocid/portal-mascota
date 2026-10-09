<script setup>
import { onMounted, ref } from 'vue'
import { api, mensajeError } from '../services/api'

const cargando = ref(true)
const salud = ref(null)
const error = ref('')

async function revisar() {
  cargando.value = true
  error.value = ''
  try {
    const { data } = await api.get('/health')
    salud.value = data
  } catch (err) {
    // 503 trae el detalle de la base de datos en el cuerpo
    salud.value = err.response?.data?.baseDatos ? err.response.data : null
    if (!salud.value) error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
}

onMounted(revisar)
</script>

<template>
  <section class="estado">
    <header>
      <h3>Estado del sistema</h3>
      <button class="secundario" :disabled="cargando" @click="revisar">
        {{ cargando ? 'Revisando…' : 'Revisar' }}
      </button>
    </header>

    <ul v-if="salud">
      <li>
        <span class="punto ok"></span>
        API <small>{{ salud.status }}</small>
      </li>
      <li>
        <span class="punto" :class="salud.baseDatos.conectada ? 'ok' : 'mal'"></span>
        Base de datos
        <small v-if="salud.baseDatos.conectada">conectada · {{ salud.baseDatos.ms }} ms</small>
        <small v-else>{{ salud.baseDatos.error }}</small>
      </li>
      <li v-if="salud.baseDatos.conectada">
        <span class="punto" :class="salud.baseDatos.tablaUsuarios ? 'ok' : 'aviso'"></span>
        Tabla usuarios
        <small>{{ salud.baseDatos.tablaUsuarios ? 'ok' : salud.baseDatos.detalle }}</small>
      </li>
    </ul>
    <p v-else-if="error" class="error">
      <span class="punto mal"></span> API sin respuesta: {{ error }}
    </p>
  </section>
</template>

<style scoped>
.estado {
  border: 1px solid var(--border);
  border-radius: var(--radio);
  padding: 16px 20px;
  background: var(--superficie);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
h3 {
  margin: 0;
  font-size: 1rem;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
li,
.error {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0;
}
small {
  color: var(--text-suave);
}
.punto {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.ok {
  background: var(--ok);
}
.aviso {
  background: var(--aviso);
}
.mal {
  background: var(--peligro);
}
</style>
