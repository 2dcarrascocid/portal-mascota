<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { TIPOS_ORGANIZACION } from '../lib/catalogos'
import { mensajeError } from '../services/api'

const route = useRoute()
const router = useRouter()
const { usuario, listarOrganizacionesPublicas, unirseAOrganizacion, crearOrganizacion } = useAuth()

const modo = ref('unirse') // 'unirse' | 'crear'
const organizaciones = ref([])
const cargando = ref(true)
const seleccionada = ref('')

const nueva = reactive({
  name: '',
  type: 'INDEPENDENT',
  taxId: '',
  address: '',
  phone: '',
  email: usuario.value?.email ?? '',
})
// Las municipalidades las da de alta un SUPER_ADMIN (ver create_organization).
const tiposCreables = Object.entries(TIPOS_ORGANIZACION).filter(([k]) => k !== 'MUNICIPALITY')

const error = ref('')
const enviando = ref(false)

onMounted(async () => {
  try {
    organizaciones.value = await listarOrganizacionesPublicas()
    if (!organizaciones.value.length) modo.value = 'crear'
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    cargando.value = false
  }
})

async function enviar(accion) {
  error.value = ''
  enviando.value = true
  try {
    await accion()
    router.replace(route.query.redirect || { name: 'inicio' })
  } catch (err) {
    error.value = mensajeError(err)
  } finally {
    enviando.value = false
  }
}

const unirse = () => enviar(() => unirseAOrganizacion(seleccionada.value))
const crear = () => enviar(() => crearOrganizacion(nueva))
</script>

<template>
  <main class="auth ancho">
    <div class="tarjeta">
      <h1>Elige tu entidad</h1>
      <p class="suave">
        Tu cuenta debe pertenecer a la empresa, municipalidad o profesional que presta los servicios.
      </p>

      <div class="pestanas" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="modo === 'unirse'"
          :class="{ secundario: modo !== 'unirse' }"
          @click="modo = 'unirse'"
        >
          Unirme a una entidad
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="modo === 'crear'"
          :class="{ secundario: modo !== 'crear' }"
          @click="modo = 'crear'"
        >
          Registrar mi entidad
        </button>
      </div>

      <form v-if="modo === 'unirse'" class="formulario" @submit.prevent="unirse">
        <p v-if="cargando" class="suave">Cargando entidades…</p>
        <p v-else-if="!organizaciones.length" class="suave">
          No hay entidades con registro abierto. Pide a tu entidad que te agregue o registra la tuya.
        </p>
        <template v-else>
          <label v-for="o in organizaciones" :key="o.id" class="opcion">
            <input v-model="seleccionada" type="radio" name="organizacion" :value="o.id" required />
            <span>
              {{ o.name }}
              <small class="suave">{{ TIPOS_ORGANIZACION[o.type] }}</small>
            </span>
          </label>
          <button :disabled="enviando || !seleccionada">{{ enviando ? 'Uniendo…' : 'Unirme' }}</button>
        </template>
      </form>

      <form v-else class="formulario" @submit.prevent="crear">
        <label>
          Nombre
          <input v-model="nueva.name" required />
        </label>
        <label>
          Tipo
          <select v-model="nueva.type">
            <option v-for="[valor, etiqueta] in tiposCreables" :key="valor" :value="valor">{{ etiqueta }}</option>
          </select>
        </label>
        <label>
          RUT / identificador tributario
          <input v-model="nueva.taxId" />
        </label>
        <label>
          Dirección
          <input v-model="nueva.address" autocomplete="street-address" />
        </label>
        <label>
          Teléfono
          <input v-model="nueva.phone" type="tel" autocomplete="tel" />
        </label>
        <label>
          Email de contacto
          <input v-model="nueva.email" type="email" />
        </label>
        <p class="suave nota">Quedarás como administrador de la entidad.</p>
        <button :disabled="enviando">{{ enviando ? 'Registrando…' : 'Registrar entidad' }}</button>
      </form>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>
  </main>
</template>

<style scoped>
.pestanas {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.opcion {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
.opcion span {
  display: grid;
}
.nota {
  margin: 0;
  font-size: 0.9rem;
}
</style>
