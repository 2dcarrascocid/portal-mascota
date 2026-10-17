-- ============================================================
-- Migration: 0006_configuracion_roles_agendas.sql
-- Description: Módulo de Configuración.
--   1. Roles configurables por organización (permisos por módulo/acción)
--      y su asignación al personal (usuarios.role_id).
--   2. Servicios asignados a especialidades (N a N).
--   3. Agendas: vigencia (desde/hasta) de los bloques semanales y
--      excepciones: bloqueos, horarios extra y cambios de horario.
--   Acceso: solo el backend (service_role), igual que el resto del esquema.
-- Date: 2026-10-11
-- Backward compatible: YES (solo agrega tablas y columnas nullable). El
--   personal sin rol asignado conserva los permisos de antes (los aplica
--   el backend).
-- ============================================================

-- ── Roles configurables ──────────────────────────────────────
-- permissions: códigos 'modulo.accion' (p. ej. 'agendas.crear'). El catálogo
-- válido vive en el backend (src/lib/permisos.js), que valida al guardar.
-- El cargo ORG_ADMIN (usuarios.role) siempre tiene acceso total.
create table animal.roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references animal.organizations (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  description      text,
  permissions      text[] not null default '{}',
  created_at       timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

alter table animal.usuarios add column if not exists role_id uuid;
-- FK compuesta: el rol debe ser de la misma organización. Al borrar el rol
-- solo se limpia role_id (no organization_id).
alter table animal.usuarios
  add constraint usuarios_role_fk foreign key (role_id, organization_id)
  references animal.roles (id, organization_id) on delete set null (role_id);

create index usuarios_role_id_idx on animal.usuarios (role_id);

-- ── Servicios por especialidad ───────────────────────────────
alter table animal.services_catalog
  add constraint services_catalog_id_organization_key unique (id, organization_id);

create table animal.specialty_services (
  specialty_id     uuid not null,
  service_id       uuid not null,
  organization_id  uuid not null,
  created_at       timestamptz not null default now(),
  primary key (specialty_id, service_id),
  foreign key (specialty_id, organization_id) references animal.specialties (id, organization_id) on delete cascade,
  foreign key (service_id, organization_id) references animal.services_catalog (id, organization_id) on delete cascade
);

create index specialty_services_service_idx on animal.specialty_services (service_id);

-- ── Agendas: vigencia de los bloques semanales ───────────────
-- null = sin límite por ese lado.
alter table animal.schedules
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add constraint schedules_vigencia_check check (valid_from is null or valid_to is null or valid_to >= valid_from);

-- ── Agendas: excepciones ─────────────────────────────────────
-- BLOQUEO         no se atiende (feriado, vacaciones, licencia...). Alcance:
--                 un profesional, una sucursal o toda la organización (nulls);
--                 sin horas = el día completo.
-- HORARIO_EXTRA   atención adicional a la semanal en esas fechas.
-- CAMBIO_HORARIO  en esas fechas reemplaza el horario semanal del
--                 profesional en esa sucursal.
create type animal.schedule_exception_type as enum ('BLOQUEO', 'HORARIO_EXTRA', 'CAMBIO_HORARIO');

create table animal.schedule_exceptions (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references animal.organizations (id) on delete cascade,
  type                   animal.schedule_exception_type not null,
  staff_id               uuid,
  branch_id              uuid,
  start_date             date not null,
  end_date               date not null,
  start_time             time,
  end_time               time,
  slot_duration_minutes  int check (slot_duration_minutes between 5 and 480),
  reason                 text,
  created_by             uuid references animal.usuarios (id) on delete set null,
  created_at             timestamptz not null default now(),
  check (end_date >= start_date),
  check ((start_time is null) = (end_time is null)),
  check (end_time > start_time),
  check (
    type = 'BLOQUEO'
    or (staff_id is not null and branch_id is not null and start_time is not null and slot_duration_minutes is not null)
  ),
  -- Con columnas null (MATCH SIMPLE) la FK no se evalúa: un bloqueo de toda
  -- la sucursal no exige profesional, y viceversa.
  foreign key (staff_id, organization_id) references animal.usuarios (id, organization_id) on delete cascade,
  foreign key (branch_id, organization_id) references animal.branches (id, organization_id) on delete cascade,
  foreign key (staff_id, branch_id, organization_id)
    references animal.staff_branches (staff_id, branch_id, organization_id) on delete cascade
);

create index schedule_exceptions_fechas_idx on animal.schedule_exceptions (organization_id, start_date, end_date);
create index schedule_exceptions_staff_idx on animal.schedule_exceptions (staff_id);

-- ── Acceso: solo el backend ──────────────────────────────────
alter table animal.roles enable row level security;
alter table animal.specialty_services enable row level security;
alter table animal.schedule_exceptions enable row level security;

revoke all on animal.roles, animal.specialty_services, animal.schedule_exceptions from anon, authenticated;
grant all on animal.roles, animal.specialty_services, animal.schedule_exceptions to service_role;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- drop table if exists animal.schedule_exceptions;
-- drop type if exists animal.schedule_exception_type;
-- alter table animal.schedules drop constraint if exists schedules_vigencia_check,
--   drop column if exists valid_from, drop column if exists valid_to;
-- drop table if exists animal.specialty_services;
-- alter table animal.services_catalog drop constraint if exists services_catalog_id_organization_key;
-- alter table animal.usuarios drop constraint if exists usuarios_role_fk;
-- alter table animal.usuarios drop column if exists role_id;
-- drop table if exists animal.roles;
