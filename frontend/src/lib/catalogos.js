// Etiquetas de los enums de la base de datos (user_role, organization_type).
export const ROLES = {
  SUPER_ADMIN: 'Super admin',
  ORG_ADMIN: 'Administrador',
  VET: 'Veterinario/a',
  GROOMER: 'Peluquero/a',
  TRAINER: 'Adiestrador/a',
  CLIENT: 'Cliente',
}

export const TIPOS_ORGANIZACION = {
  PRIVATE_COMPANY: 'Empresa privada',
  MUNICIPALITY: 'Municipalidad',
  INDEPENDENT: 'Independiente',
}

export const CATEGORIAS_SERVICIO = {
  GROOMING: 'Peluquería',
  VET: 'Veterinaria',
  TRAINING: 'Adiestramiento',
}

// day_of_week de la base: 0 = domingo
export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

// Orden de la semana para mostrar (lunes primero)
export const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0]

// Roles que puede asignar un ORG_ADMIN (SUPER_ADMIN no)
export const ROLES_ASIGNABLES = ['ORG_ADMIN', 'VET', 'GROOMER', 'TRAINER', 'CLIENT']

export const ROLES_PERSONAL = ['ORG_ADMIN', 'VET', 'GROOMER', 'TRAINER']
