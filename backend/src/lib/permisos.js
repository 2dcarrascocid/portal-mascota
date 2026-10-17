// Catálogo de permisos ('modulo.accion') que se asignan a los roles
// configurables (tabla roles). El cargo ORG_ADMIN siempre tiene todos; la
// gestión de roles es exclusiva suya (quien edita roles podría darse
// cualquier permiso), por eso 'roles' no está en el catálogo.

const ACCIONES = ['ver', 'crear', 'editar', 'eliminar'];

const MODULOS = [
  { clave: 'personal', nombre: 'Personal', grupo: 'Configuración' },
  { clave: 'especialidades', nombre: 'Especialidades', grupo: 'Configuración' },
  { clave: 'servicios', nombre: 'Servicios', grupo: 'Configuración' },
  { clave: 'agendas', nombre: 'Programación de agenda', grupo: 'Configuración' },
  { clave: 'sucursales', nombre: 'Sucursales', grupo: 'Configuración' },
  { clave: 'especies', nombre: 'Especies y razas', grupo: 'Configuración' },
  { clave: 'citas', nombre: 'Agenda (citas)', grupo: 'Operación' },
  { clave: 'recepcion', nombre: 'Recepción y atenciones', grupo: 'Operación' },
  { clave: 'tutores', nombre: 'Tutores y mascotas', grupo: 'Operación' },
];

const PERMISOS = MODULOS.flatMap((m) => ACCIONES.map((a) => `${m.clave}.${a}`));

// Personal sin rol asignado: lo que podía hacer antes de existir los roles
// (consultar todo menos el personal, registrar/editar tutores y mascotas)
// y agendar citas y recibir/atender en recepción (anular queda para roles).
const PERMISOS_BASICOS = [
  'especialidades.ver',
  'servicios.ver',
  'agendas.ver',
  'sucursales.ver',
  'especies.ver',
  'citas.ver',
  'citas.crear',
  'citas.editar',
  'recepcion.ver',
  'recepcion.crear',
  'recepcion.editar',
  'tutores.ver',
  'tutores.crear',
  'tutores.editar',
];

// usuario: { role, rol: { permissions } | null } (rol = embed de roles).
function permisosDe({ role, rol }) {
  if (role === 'ORG_ADMIN') return [...PERMISOS];
  if (!['STAFF', 'VET', 'GROOMER', 'TRAINER'].includes(role)) return [];
  return rol ? rol.permissions.filter((p) => PERMISOS.includes(p)) : [...PERMISOS_BASICOS];
}

// Normaliza la lista de un rol: solo códigos válidos y, si hay alguna acción
// sobre un módulo, también 'ver' (no se edita lo que no se puede ver).
function normalizar(lista) {
  const validos = new Set(lista.filter((p) => PERMISOS.includes(p)));
  for (const p of [...validos]) validos.add(`${p.split('.')[0]}.ver`);
  return PERMISOS.filter((p) => validos.has(p));
}

module.exports = { ACCIONES, MODULOS, PERMISOS, PERMISOS_BASICOS, permisosDe, normalizar };
