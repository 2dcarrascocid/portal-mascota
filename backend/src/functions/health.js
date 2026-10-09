const { supabase } = require('../lib/supabase');
const { json, handler } = require('../lib/http');

// Hace una consulta mínima para confirmar que Supabase responde y la clave es válida.
async function revisarBaseDatos() {
  const inicio = Date.now();
  try {
    // Sin `head: true`: en un HEAD PostgREST no manda cuerpo y el error se pierde.
    const { count, error } = await supabase()
      .from('usuarios')
      .select('id', { count: 'exact' })
      .limit(1);
    const ms = Date.now() - inicio;

    if (!error) return { conectada: true, ms, tablaUsuarios: true, usuarios: count };
    // Tabla inexistente: hay conexión, falta correr la migración.
    if (error.code === 'PGRST205' || error.code === '42P01') {
      return { conectada: true, ms, tablaUsuarios: false, detalle: 'Falta ejecutar la migración 0003_usuarios_propios.sql' };
    }
    // Schema animal no expuesto en Settings > API > Exposed schemas.
    if (error.code === 'PGRST106') {
      return { conectada: true, ms, tablaUsuarios: false, detalle: 'Falta exponer el schema animal en la API de Supabase' };
    }
    return { conectada: false, ms, error: error.message || error.code || 'Error desconocido' };
  } catch (err) {
    return { conectada: false, ms: Date.now() - inicio, error: err.message };
  }
}

module.exports.handler = handler(async () => {
  const baseDatos = await revisarBaseDatos();
  return json(baseDatos.conectada ? 200 : 503, {
    status: baseDatos.conectada ? 'ok' : 'degradado',
    servicio: 'portalanimal-backend',
    fecha: new Date().toISOString(),
    baseDatos,
  });
});
