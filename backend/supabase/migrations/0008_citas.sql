-- ============================================================
-- Migration: 0008_citas.sql
-- Description: Módulo Agenda. Citas reservadas sobre los turnos que
--   generan los horarios (schedules + schedule_exceptions). Una cita
--   ocupa un turno de un profesional en una sucursal.
--   Con ficha: tutor (client_id) y opcionalmente mascota (pet_id).
--   Sin ficha: solo datos de contacto; se puede vincular después.
-- Date: 2026-10-11
-- Backward compatible: YES (solo agrega tablas).
-- Requiere: 0006_configuracion_roles_agendas.sql
-- ============================================================

-- Para la FK (pet_id, client_id): la mascota de la cita debe ser de ese tutor.
alter table animal.pets add constraint pets_id_client_key unique (id, client_id);

create type animal.appointment_status as enum ('RESERVADA', 'CONFIRMADA', 'ATENDIDA', 'NO_ASISTIO', 'CANCELADA');

create table animal.appointments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references animal.organizations (id) on delete cascade,
  branch_id        uuid not null,
  -- Sin FK compuesta a staff_branches: la cita es historia y debe
  -- sobrevivir si el profesional deja la sucursal o la entidad.
  staff_id         uuid not null references animal.usuarios (id),
  date             date not null,
  start_time       time not null,
  end_time         time not null,
  service_id       uuid references animal.services_catalog (id) on delete set null,
  specialty_id     uuid references animal.specialties (id) on delete set null,
  client_id        uuid,
  pet_id           uuid references animal.pets (id) on delete set null,
  contact_name     text,
  contact_phone    text,
  contact_email    text,
  notes            text,
  status           animal.appointment_status not null default 'RESERVADA',
  cancel_reason    text,
  created_by       uuid references animal.usuarios (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_time > start_time),
  -- Con ficha (tutor) o, sin ficha, al menos el nombre de contacto. El
  -- backend siempre copia el nombre del tutor, así la cita conserva el
  -- contacto si después se borra la ficha.
  check (client_id is not null or length(trim(contact_name)) > 0),
  foreign key (branch_id, organization_id) references animal.branches (id, organization_id) on delete cascade,
  foreign key (client_id, organization_id) references animal.clients (id, organization_id) on delete set null (client_id),
  -- La mascota debe ser de ese tutor (solo verifica; la limpieza al borrar
  -- la hace la FK simple de pet_id). Que no haya mascota sin tutor lo valida
  -- el backend: al borrar un tutor, las columnas se limpian en dos pasos.
  foreign key (pet_id, client_id) references animal.pets (id, client_id)
);

-- Un turno no se puede reservar dos veces (las canceladas lo liberan).
-- Los turnos son una grilla fija por profesional, así que basta con la hora
-- de inicio; el backend además valida que el turno exista y esté libre.
create unique index appointments_turno_unico
  on animal.appointments (staff_id, date, start_time)
  where status <> 'CANCELADA';

create index appointments_fecha_idx on animal.appointments (organization_id, date);
create index appointments_client_idx on animal.appointments (client_id);
create index appointments_pet_idx on animal.appointments (pet_id);

-- ── Acceso: solo el backend ──────────────────────────────────
alter table animal.appointments enable row level security;
revoke all on animal.appointments from anon, authenticated;
grant all on animal.appointments to service_role;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- drop table if exists animal.appointments;
-- drop type if exists animal.appointment_status;
-- alter table animal.pets drop constraint if exists pets_id_client_key;
