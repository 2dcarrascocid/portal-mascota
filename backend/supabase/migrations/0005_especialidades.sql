-- ============================================================
-- Migration: 0005_especialidades.sql
-- Description: Catálogo de especialidades por organización y su
--   asignación al personal (N a N). Reemplaza el texto libre
--   usuarios.specialty: los valores existentes se traspasan al catálogo.
-- Date: 2026-10-08
-- Backward compatible: NO. Elimina usuarios.specialty (requiere el
--   backend actualizado, que usa staff_specialties).
-- ============================================================

-- ── Catálogo ─────────────────────────────────────────────────
-- category: área de la especialidad (null = general, aplica a cualquiera).
create table animal.specialties (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references animal.organizations (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  category         animal.service_category,
  description      text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

-- ── Asignación al personal ───────────────────────────────────
-- FKs compuestas: persona y especialidad deben ser de la misma organización.
create table animal.staff_specialties (
  staff_id         uuid not null,
  specialty_id     uuid not null,
  organization_id  uuid not null,
  created_at       timestamptz not null default now(),
  primary key (staff_id, specialty_id),
  foreign key (staff_id, organization_id) references animal.usuarios (id, organization_id) on delete cascade,
  foreign key (specialty_id, organization_id) references animal.specialties (id, organization_id) on delete cascade
);

create index staff_specialties_specialty_idx on animal.staff_specialties (specialty_id);

-- ── Acceso: solo el backend ──────────────────────────────────
alter table animal.specialties enable row level security;
alter table animal.staff_specialties enable row level security;

revoke all on animal.specialties, animal.staff_specialties from anon, authenticated;
grant all on animal.specialties, animal.staff_specialties to service_role;

-- ── Traspaso del texto libre usuarios.specialty ──────────────
-- Cada texto distinto (por organización) pasa a ser una especialidad, con
-- el área según el rol de quien la tenía.
insert into animal.specialties (organization_id, name, category)
select distinct on (u.organization_id, lower(trim(u.specialty)))
  u.organization_id,
  trim(u.specialty),
  case u.role
    when 'VET' then 'VET'::animal.service_category
    when 'GROOMER' then 'GROOMING'::animal.service_category
    when 'TRAINER' then 'TRAINING'::animal.service_category
  end
from animal.usuarios u
where u.organization_id is not null and nullif(trim(u.specialty), '') is not null
order by u.organization_id, lower(trim(u.specialty)), u.created_at
on conflict (organization_id, name) do nothing;

insert into animal.staff_specialties (staff_id, specialty_id, organization_id)
select u.id, s.id, u.organization_id
from animal.usuarios u
join animal.specialties s
  on s.organization_id = u.organization_id and lower(s.name) = lower(trim(u.specialty))
where nullif(trim(u.specialty), '') is not null
on conflict do nothing;

alter table animal.usuarios drop column specialty;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- alter table animal.usuarios add column specialty text;
-- update animal.usuarios u set specialty = (
--   select string_agg(s.name, ', ' order by s.name)
--   from animal.staff_specialties ss join animal.specialties s on s.id = ss.specialty_id
--   where ss.staff_id = u.id);
-- drop table if exists animal.staff_specialties;
-- drop table if exists animal.specialties;
