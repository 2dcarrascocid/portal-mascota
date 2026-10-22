// Punto de entrada único: API Gateway envía todo a esta Lambda (ANY /{proxy+})
// y aquí se enruta por método + path. Los segmentos `:nombre` se entregan en
// event.pathParameters.
const health = require('./functions/health');
const auth = require('./functions/auth');
const organizaciones = require('./functions/organizaciones');
const sucursales = require('./functions/sucursales');
const personal = require('./functions/personal');
const especialidades = require('./functions/especialidades');
const agendas = require('./functions/agendas');
const roles = require('./functions/roles');
const geo = require('./functions/geo');
const citas = require('./functions/citas');
const recepcion = require('./functions/recepcion');
const caja = require('./functions/caja');
const catalogos = require('./functions/catalogos');
const tutores = require('./functions/tutores');
const notificaciones = require('./functions/notificaciones');
const webpay = require('./functions/webpay');
const portal = require('./functions/portal');
const contactabilidad = require('./functions/contactabilidad');
const { json } = require('./lib/http');

const rutas = {
  'GET /health': health.handler,
  'POST /auth/registro': auth.registro,
  'POST /auth/login': auth.login,
  'POST /auth/refresh': auth.refresh,
  'POST /auth/logout': auth.logout,
  'POST /auth/verificar': auth.verificar,
  'POST /auth/reenviar-verificacion': auth.reenviarVerificacion,
  'POST /auth/recuperar': auth.recuperar,
  'POST /auth/restablecer': auth.restablecer,
  'POST /auth/google/token': auth.googleToken,
  'GET /auth/oauth/google': auth.google,
  'GET /auth/oauth/google/callback': auth.googleCallback,
  'GET /auth/oauth/facebook': auth.facebook,
  'GET /auth/oauth/facebook/callback': auth.facebookCallback,
  'GET /auth/me': auth.me,
  'GET /organizaciones/publicas': organizaciones.publicas,
  'POST /organizaciones': organizaciones.crear,
  'POST /organizaciones/unirse': organizaciones.unirse,
  'POST /perfiles/asignar': organizaciones.asignar,

  'GET /sucursales': sucursales.listar,
  'POST /sucursales': sucursales.crear,
  'PUT /sucursales/:id': sucursales.actualizar,
  'DELETE /sucursales/:id': sucursales.eliminar,

  'GET /personal': personal.listar,
  'POST /personal': personal.crear,
  'PUT /personal/:id': personal.actualizar,
  'DELETE /personal/:id': personal.quitar,
  'PUT /personal/:id/rol': personal.asignarRol,
  'PUT /personal/:id/sucursales': personal.asignarSucursales,
  'PUT /personal/:id/estado': personal.cambiarEstado,
  'POST /personal/:id/invitacion': personal.reenviarInvitacion,

  'GET /especialidades': especialidades.listar,
  'POST /especialidades': especialidades.crear,
  'PUT /especialidades/:id': especialidades.actualizar,
  'DELETE /especialidades/:id': especialidades.eliminar,

  'GET /citas/disponibles': citas.disponibles,
  'GET /citas': citas.listar,
  'POST /citas': citas.crear,
  'PUT /citas/:id': citas.actualizar,
  'PUT /citas/:id/estado': citas.cambiarEstado,
  'DELETE /citas/:id': citas.eliminar,

  'GET /recepcion': recepcion.listar,
  'POST /atenciones': recepcion.crear,
  'GET /atenciones/:id': recepcion.obtener,
  'PUT /atenciones/:id': recepcion.actualizar,
  'POST /atenciones/:id/prestaciones': recepcion.agregarPrestacion,
  'DELETE /atenciones/:id/prestaciones/:itemId': recepcion.quitarPrestacion,
  'POST /atenciones/:id/pagos': recepcion.registrarPago,
  'DELETE /atenciones/:id/pagos/:pagoId': recepcion.quitarPago,
  'POST /atenciones/:id/cerrar': recepcion.cerrar,
  'POST /atenciones/:id/anular': recepcion.anular,

  'GET /caja': caja.resumen,
  'GET /caja/cierres': caja.listarCierres,
  'POST /caja/cierres': caja.cerrar,
  'DELETE /caja/cierres/:id': caja.reabrir,

  'GET /geo/buscar': geo.buscar,
  'GET /geo/inversa': geo.inversa,

  'GET /roles': roles.listar,
  'POST /roles': roles.crear,
  'PUT /roles/:id': roles.actualizar,
  'DELETE /roles/:id': roles.eliminar,

  'GET /agendas': agendas.listar,
  'POST /agendas': agendas.crear,
  'POST /agendas/lote': agendas.crearLote,
  'PUT /agendas/:id': agendas.actualizar,
  'DELETE /agendas/:id': agendas.eliminar,
  'POST /agendas/copiar': agendas.copiar,
  'POST /agendas/mover-dia': agendas.moverDia,
  'GET /agendas/disponibilidad': agendas.disponibilidad,
  'GET /agendas/excepciones': agendas.listarExcepciones,
  'POST /agendas/excepciones': agendas.crearExcepcion,
  'PUT /agendas/excepciones/:id': agendas.actualizarExcepcion,
  'DELETE /agendas/excepciones/:id': agendas.eliminarExcepcion,

  'GET /especies': catalogos.listarEspecies,
  'POST /especies': catalogos.crearEspecie,
  'DELETE /especies/:id': catalogos.eliminarEspecie,
  'POST /especies/:id/razas': catalogos.crearRaza,
  'DELETE /razas/:id': catalogos.eliminarRaza,
  'GET /servicios': catalogos.listarServicios,
  'POST /servicios': catalogos.crearServicio,
  'PUT /servicios/:id': catalogos.actualizarServicio,
  'DELETE /servicios/:id': catalogos.eliminarServicio,

  'GET /tutores': tutores.listar,
  'POST /tutores': tutores.crear,
  'GET /tutores/:id': tutores.obtener,
  'PUT /tutores/:id': tutores.actualizar,
  'DELETE /tutores/:id': tutores.eliminar,
  'POST /tutores/:id/mascotas': tutores.agregarMascota,
  'PUT /mascotas/:id': tutores.actualizarMascota,
  'DELETE /mascotas/:id': tutores.eliminarMascota,

  // Portal del tutor (rol CLIENT)
  'GET /portal/perfil': portal.obtenerPerfil,
  'PUT /portal/perfil': portal.guardarPerfil,
  'GET /portal/especies': portal.especies,
  'GET /portal/mascotas': portal.listarMascotas,
  'POST /portal/mascotas': portal.crearMascota,
  'PUT /portal/mascotas/:id': portal.actualizarMascota,
  'DELETE /portal/mascotas/:id': portal.eliminarMascota,
  'GET /portal/sucursales': portal.sucursales,
  'GET /portal/sucursales/:id': portal.sucursal,
  'GET /portal/disponibles': portal.disponibles,
  'GET /portal/citas': portal.listarCitas,
  'POST /portal/citas': portal.reservar,
  'POST /portal/citas/:id/pago': portal.pagarCita,
  'POST /portal/citas/:id/cancelar': portal.cancelarCita,
  'GET /portal/historial': portal.historial,

  // Credenciales del sistema de contactabilidad (ORG_ADMIN)
  'GET /integraciones/credenciales': contactabilidad.listarCredenciales,
  'POST /integraciones/credenciales': contactabilidad.crearCredencial,
  'DELETE /integraciones/credenciales/:id': contactabilidad.revocarCredencial,

  // API inter-sistema para la contactabilidad (OAuth2 client credentials)
  'POST /api/v1/oauth/token': contactabilidad.token,
  'GET /api/v1/estados': contactabilidad.matrizEstados,
  'GET /api/v1/citas/programadas': contactabilidad.programadas,
  'POST /api/v1/citas/:id/estado': contactabilidad.actualizarEstado,
  'POST /api/v1/citas/:id/liberar': contactabilidad.liberar,
  'GET /api/v1/citas/:id/disponibles': contactabilidad.disponiblesReagenda,
  'POST /api/v1/citas/:id/reagendar': contactabilidad.reagendar,

  'POST /notificaciones/email': notificaciones.enviarEmail,
  'POST /webpay/transacciones': webpay.crear,
  'GET /webpay/retorno': webpay.retorno,
  'POST /webpay/retorno': webpay.retorno,
};

// Rutas con parámetros, precompiladas: [método, segmentos, handler]
const conParametros = Object.entries(rutas)
  .filter(([clave]) => clave.includes('/:'))
  .map(([clave, fn]) => {
    const [metodo, patron] = clave.split(' ');
    return [metodo, patron.split('/'), fn];
  });

function buscarRuta(metodo, path) {
  const exacta = rutas[`${metodo} ${path}`];
  if (exacta) return { fn: exacta, params: {} };

  const segmentos = path.split('/');
  for (const [m, patron, fn] of conParametros) {
    if (m !== metodo || patron.length !== segmentos.length) continue;
    const params = {};
    const coincide = patron.every((p, i) => {
      if (p.startsWith(':')) {
        params[p.slice(1)] = decodeURIComponent(segmentos[i]);
        return segmentos[i] !== '';
      }
      return p === segmentos[i];
    });
    if (coincide) return { fn, params };
  }
  return null;
}

module.exports.api = async (event, context) => {
  const metodo = event.requestContext.http.method;
  const path = (event.rawPath || '/').replace(/\/+$/, '') || '/';

  const ruta = buscarRuta(metodo, path);
  if (!ruta) return json(404, { error: `Ruta no encontrada: ${metodo} ${path}` });

  event.pathParameters = { ...(event.pathParameters || {}), ...ruta.params };
  return ruta.fn(event, context);
};
