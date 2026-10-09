const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const { HttpError } = require('./http');

let cliente;

// Cliente reutilizado entre invocaciones de la misma instancia Lambda.
// Usa la service_role: es el único acceso a la base de datos. Supabase Auth
// no se usa (la autenticación es propia, ver lib/sesiones.js).
function supabase() {
  if (!cliente) {
    const { url, key, schema } = config.supabase();
    cliente = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      db: { schema },
    });
  }
  return cliente;
}

// Convierte errores de PostgREST/RPC en HttpError legibles.
// Las RPC lanzan 42501 (no autorizado) o P0001 (regla de negocio).
function errorDb(error) {
  if (error.code === '42501') return new HttpError(403, error.message);
  if (error.code === 'P0001') return new HttpError(400, error.message);
  if (error.code === '23505') return new HttpError(409, 'Ya existe un registro con esos datos');
  if (error.code === '23503') return new HttpError(400, 'Hace referencia a un registro que no existe o no es de tu organización');
  if (error.code === '23514') return new HttpError(400, 'Hay datos fuera de rango o inválidos');
  if (error.code === '22P02' || error.code === '22007') return new HttpError(400, 'Formato de dato inválido');
  return error;
}

module.exports = { supabase, errorDb };
