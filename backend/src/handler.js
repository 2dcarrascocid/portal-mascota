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
const catalogos = require('./functions/catalogos');
const tutores = require('./functions/tutores');
const notificaciones = require('./functions/notificaciones');
const webpay = require('./functions/webpay');
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
  'PUT /personal/:id/sucursales': personal.asignarSucursales,
  'PUT /personal/:id/estado': personal.cambiarEstado,
  'POST /personal/:id/invitacion': personal.reenviarInvitacion,

  'GET /especialidades': especialidades.listar,
  'POST /especialidades': especialidades.crear,
  'PUT /especialidades/:id': especialidades.actualizar,
  'DELETE /especialidades/:id': especialidades.eliminar,

  'GET /agendas': agendas.listar,
  'POST /agendas': agendas.crear,
  'PUT /agendas/:id': agendas.actualizar,
  'DELETE /agendas/:id': agendas.eliminar,

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
