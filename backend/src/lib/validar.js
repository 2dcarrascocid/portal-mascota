// Validación de entradas: cada función devuelve el valor normalizado o lanza 400.
const { HttpError } = require('./http');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d(:00)?$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const falla = (campo, detalle) => {
  throw new HttpError(400, `${campo}: ${detalle}`);
};

// Texto; '' o null => null (o error si es requerido).
function texto(valor, campo, { requerido = false, max = 300 } = {}) {
  const t = typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor).trim();
  if (!t) return requerido ? falla(campo, 'es obligatorio') : null;
  if (t.length > max) falla(campo, `máximo ${max} caracteres`);
  return t;
}

function uuid(valor, campo, { requerido = true } = {}) {
  if (valor == null || valor === '') return requerido ? falla(campo, 'es obligatorio') : null;
  if (!UUID.test(String(valor))) falla(campo, 'identificador inválido');
  return String(valor);
}

function email(valor, campo) {
  const t = texto(valor, campo, { max: 200 });
  if (t && !EMAIL.test(t)) falla(campo, 'email inválido');
  return t?.toLowerCase() ?? null;
}

function entero(valor, campo, { min, max, requerido = true } = {}) {
  if (valor == null || valor === '') return requerido ? falla(campo, 'es obligatorio') : null;
  const n = Number(valor);
  if (!Number.isInteger(n) || (min != null && n < min) || (max != null && n > max)) {
    falla(campo, `debe ser un entero${min != null ? ` entre ${min}` : ''}${max != null ? ` y ${max}` : ''}`);
  }
  return n;
}

function numero(valor, campo, { min = 0, requerido = false } = {}) {
  if (valor == null || valor === '') return requerido ? falla(campo, 'es obligatorio') : null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < min) falla(campo, `debe ser un número mayor o igual a ${min}`);
  return n;
}

function hora(valor, campo) {
  if (!HORA.test(String(valor || ''))) falla(campo, 'hora inválida (HH:MM)');
  return String(valor).slice(0, 5);
}

function fecha(valor, campo) {
  if (valor == null || valor === '') return null;
  if (!FECHA.test(String(valor)) || Number.isNaN(Date.parse(valor))) falla(campo, 'fecha inválida (AAAA-MM-DD)');
  return String(valor);
}

function opcion(valor, campo, opciones) {
  if (!opciones.includes(valor)) falla(campo, `debe ser uno de: ${opciones.join(', ')}`);
  return valor;
}

const booleano = (valor, porDefecto = true) => (typeof valor === 'boolean' ? valor : porDefecto);

module.exports = { texto, uuid, email, entero, numero, hora, fecha, opcion, booleano };
