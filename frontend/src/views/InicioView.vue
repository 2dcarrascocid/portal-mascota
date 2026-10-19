<script setup>
import { ref } from 'vue'
import EstadoSistema from '../components/EstadoSistema.vue'
import { useAuth } from '../composables/useAuth'
import { irAWebpay } from '../lib/webpay'
import { api, mensajeError } from '../services/api'

const { usuario, perfil } = useAuth()

const monto = ref(1000)
const pagando = ref(false)
const errorPago = ref('')

// Crea la transacción en el backend y envía al usuario al formulario de Webpay.
async function pagar() {
  errorPago.value = ''
  pagando.value = true
  try {
    const { data } = await api.post('/webpay/transacciones', { amount: Number(monto.value) })
    irAWebpay(data)
  } catch (err) {
    errorPago.value = mensajeError(err)
    pagando.value = false
  }
}
</script>

<template>
  <main class="contenedor inicio">
    <h1>Hola, {{ perfil?.full_name || usuario.email }}</h1>

    <EstadoSistema />

    <section class="panel">
      <h3>Pago de prueba (Webpay)</h3>
      <form @submit.prevent="pagar">
        <label>
          Monto (CLP)
          <input v-model.number="monto" type="number" min="50" step="1" required />
        </label>
        <button :disabled="pagando">{{ pagando ? 'Redirigiendo…' : 'Pagar' }}</button>
      </form>
      <p v-if="errorPago" class="error" role="alert">{{ errorPago }}</p>
    </section>
  </main>
</template>

<style scoped>
.inicio {
  display: grid;
  gap: 16px;
}
h1 {
  margin: 0;
}
.panel {
  border: 1px solid var(--border);
  border-radius: var(--radio);
  padding: 16px 20px;
  background: var(--superficie);
}
.panel h3 {
  margin: 0 0 12px;
  font-size: 1rem;
}
form {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}
label {
  display: grid;
  gap: 4px;
  font-size: 0.9rem;
}
</style>
