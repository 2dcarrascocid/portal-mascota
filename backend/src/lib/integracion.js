// Autenticación inter-sistema (OAuth2 client credentials) para la API
// /api/v1 que consume el sistema de contactabilidad.
// Cada organización da de alta sus credenciales (integration_clients); el
// motor canjea client_id + client_secret por un access token de 1 hora.
// El token usa otra audiencia que el de los usuarios: no sirve en la API del
// portal y un token de usuario no sirve aquí.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { supabase } = require('./supabase');
const { sha256, tokenAleatorio } = require('./sesiones');
const { tokenBearer } = require('./auth');
const { HttpError } = require('./http');

const AUDIENCIA = 'portal-animal-integracion';
const TOKEN_SEGUNDOS = 3600;

const nuevoClientId = () => `pa_${crypto.randomBytes(12).toString('hex')}`;
const nuevoSecreto = () => tokenAleatorio();

const mismoHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Devuelve la credencial vigente o null (sin revelar cuál dato falló).
async function validarCredenciales(clientId, clientSecret) {
  if (!clientId || !clientSecret) return null;
  const { data, error } = await supabase()
    .from('integration_clients')
    .select('id, organization_id, client_secret_hash, revoked_at')
    .eq('client_id', String(clientId))
    .maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at || !mismoHash(data.client_secret_hash, sha256(String(clientSecret)))) return null;
  return data;
}

async function emitirToken(credencial) {
  const { error } = await supabase()
    .from('integration_clients')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', credencial.id);
  if (error) throw error;
  const token = jwt.sign({}, config.jwt().secret, { subject: credencial.id, audience: AUDIENCIA, expiresIn: TOKEN_SEGUNDOS });
  return { access_token: token, token_type: 'Bearer', expires_in: TOKEN_SEGUNDOS };
}

// Valida el Bearer token del motor y devuelve { id, organization_id } de la
// credencial. Se consulta la base en cada petición para que revocar la
// credencial corte el acceso de inmediato (sin esperar que venza el token).
async function requerirIntegracion(event) {
  let id;
  try {
    id = jwt.verify(tokenBearer(event), config.jwt().secret, { audience: AUDIENCIA }).sub;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, 'Token inválido o expirado');
  }
  const { data, error } = await supabase()
    .from('integration_clients')
    .select('id, organization_id, revoked_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at) throw new HttpError(401, 'Credencial revocada');
  return { id: data.id, organization_id: data.organization_id };
}

// ── Matriz de mapeo de estados ───────────────────────────────
// Resultado del motor de contactabilidad -> acción en el Core -> estado
// final de la cita. El motor traduce sus propios códigos a estos. Los
// resultados sin acción no se informan al Core: la cita sigue RESERVADA y
// el motor decide si reintenta o, vencido el plazo, la libera.
const MATRIZ_ESTADOS = [
  { resultado: 'CONFIRMA', descripcion: 'El tutor confirma la hora', accion: 'ESTADO', estado_core: 'CONFIRMADA' },
  { resultado: 'CANCELA', descripcion: 'El tutor cancela la hora', accion: 'ESTADO', estado_core: 'CANCELADA' },
  {
    resultado: 'REAGENDA',
    descripcion:
      'El tutor pide otra hora. Si la elige (GET /citas/{id}/disponibles), POST /citas/{id}/reagendar: ' +
      'la original queda CANCELADA y la nueva CONFIRMADA. Si no la elige, se libera el cupo.',
    accion: 'LIBERAR',
    estado_core: 'CANCELADA',
  },
  {
    resultado: 'SIN_RESPUESTA',
    descripcion: 'Mensaje entregado y vencido el plazo de confirmación sin respuesta',
    accion: 'LIBERAR',
    estado_core: 'CANCELADA',
  },
  { resultado: 'NO_CONTESTA', descripcion: 'Llamada sin respuesta, ocupado o buzón (intento)', accion: null, estado_core: 'RESERVADA' },
  { resultado: 'NO_ENTREGADO', descripcion: 'El mensaje no se pudo entregar', accion: null, estado_core: 'RESERVADA' },
  { resultado: 'NUMERO_INVALIDO', descripcion: 'Teléfono erróneo o inexistente', accion: null, estado_core: 'RESERVADA' },
];

// Estados del Core y si el motor debe gestionarlos.
const ESTADOS_CORE = [
  { estado: 'RESERVADA', descripcion: 'Agendada, pendiente de confirmar', gestionable: true },
  { estado: 'CONFIRMADA', descripcion: 'Confirmada por el tutor', gestionable: true },
  { estado: 'LLEGO', descripcion: 'El paciente está en recepción', gestionable: false },
  { estado: 'ATENDIDA', descripcion: 'Atención cerrada', gestionable: false },
  { estado: 'NO_ASISTIO', descripcion: 'No se presentó', gestionable: false },
  { estado: 'CANCELADA', descripcion: 'Cancelada o liberada (el turno queda libre)', gestionable: false },
];

// Valida que el resultado informado corresponda a la acción (y al estado).
function resultadoPara(valor, accion, estado) {
  if (valor == null || valor === '') return null;
  const fila = MATRIZ_ESTADOS.find((m) => m.resultado === valor);
  if (!fila) throw new HttpError(400, `resultado: debe ser uno de: ${MATRIZ_ESTADOS.map((m) => m.resultado).join(', ')}`);
  if (fila.accion !== accion || (estado && fila.estado_core !== estado)) {
    throw new HttpError(400, `resultado: ${valor} no corresponde a esta operación (ver matriz de estados)`);
  }
  return valor;
}

module.exports = {
  TOKEN_SEGUNDOS,
  nuevoClientId,
  nuevoSecreto,
  validarCredenciales,
  emitirToken,
  requerirIntegracion,
  MATRIZ_ESTADOS,
  ESTADOS_CORE,
  resultadoPara,
};
