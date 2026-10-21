// Secciones del menú Configuración (mantenedores básicos para implementar el
// sistema). Las usan el menú principal, el submenú y el router.
//   permiso   -> 'modulo.ver' necesario para entrar
//   soloAdmin -> exclusivo del cargo ORG_ADMIN (roles: quien los edita podría darse cualquier permiso)
export const SECCIONES_CONFIGURACION = [
  {
    path: 'roles',
    name: 'config-roles',
    texto: 'Roles y permisos',
    descripcion: 'Qué puede ver y hacer cada integrante del personal, por módulo.',
    soloAdmin: true,
  },
  {
    path: 'sucursales',
    name: 'config-sucursales',
    texto: 'Sucursales',
    descripcion: 'Locales de atención con su ubicación en el mapa, para buscar la más cercana.',
    permiso: 'sucursales.ver',
  },
  {
    path: 'personal',
    name: 'config-personal',
    texto: 'Personal',
    descripcion: 'Personas que interactúan con el sistema: datos, RUT, rol, especialidades y sucursales.',
    permiso: 'personal.ver',
  },
  {
    path: 'especialidades',
    name: 'config-especialidades',
    texto: 'Especialidades',
    descripcion: 'Atributos del personal; cada persona puede tener más de una.',
    permiso: 'especialidades.ver',
  },
  {
    path: 'servicios',
    name: 'config-servicios',
    texto: 'Servicios',
    descripcion: 'Catálogo de servicios con precio y duración, asignados a especialidades.',
    permiso: 'servicios.ver',
  },
  {
    path: 'programacion-agenda',
    name: 'config-agendas',
    texto: 'Programación de agenda',
    descripcion: 'Horarios semanales, excepciones (bloqueos, extras, cambios) y disponibilidad de citas.',
    permiso: 'agendas.ver',
  },
  {
    path: 'especies',
    name: 'config-especies',
    texto: 'Especies y razas',
    descripcion: 'Catálogo de especies y razas para la ficha de las mascotas.',
    permiso: 'especies.ver',
  },
  {
    path: 'integraciones',
    name: 'config-integraciones',
    texto: 'Integraciones',
    descripcion: 'Conexiones de servicios externos (p. ej. contactabilidad) con la agenda: credenciales y acceso.',
    soloAdmin: true,
  },
]

// ¿Puede entrar a la sección? (`auth` = useAuth())
export const accesoSeccion = (seccion, { esAdminOrg, puede }) =>
  seccion.soloAdmin ? esAdminOrg.value : puede(seccion.permiso)
