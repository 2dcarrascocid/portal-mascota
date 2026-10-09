-- ============================================================
-- Migration: 0004_estructura_catalogos_mascotas.sql
-- Description: Módulo 2. Sucursales, asignación de personal, agendas,
--   especies/razas, catálogo de servicios, tutores y mascotas.
--   Acceso: solo el backend (service_role). El aislamiento por
--   organización/sucursal lo aplica el backend; además, las FKs compuestas
--   (id, organization_id) impiden en la base mezclar datos de dos
--   organizaciones (p. ej. asignar personal a una sucursal ajena).
-- Date: 2026-10-08
-- Backward compatible: YES (solo agrega tablas y una columna nullable).
-- ============================================================

-- ── Personal: especialidad + clave para FKs por organización ─
alter table animal.usuarios add column if not exists specialty text;
alter table animal.usuarios
  add constraint usuarios_id_organization_key unique (id, organization_id);

create type animal.service_category as enum ('GROOMING', 'VET', 'TRAINING');

-- ── Sucursales ───────────────────────────────────────────────
create table animal.branches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references animal.organizations (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  address          text,
  phone            text,
  email            text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

-- ── Personal asignado a sucursales (N a N) ───────────────────
create table animal.staff_branches (
  staff_id         uuid not null,
  branch_id        uuid not null,
  organization_id  uuid not null,
  created_at       timestamptz not null default now(),
  primary key (staff_id, branch_id),
  unique (staff_id, branch_id, organization_id),
  foreign key (staff_id, organization_id) references animal.usuarios (id, organization_id) on delete cascade,
  foreign key (branch_id, organization_id) references animal.branches (id, organization_id) on delete cascade
);

create index staff_branches_branch_idx on animal.staff_branches (branch_id);

-- ── Agendas: bloques semanales de atención ───────────────────
-- La FK a staff_branches obliga a que el profesional esté asignado a esa
-- sucursal de la MISMA organización (y al quitarle la sucursal, se borran
-- sus bloques).
create table animal.schedules (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references animal.organizations (id) on delete cascade,
  staff_id               uuid not null,
  branch_id              uuid not null,
  day_of_week            smallint not null check (day_of_week between 0 and 6),  -- 0 = domingo
  start_time             time not null,
  end_time               time not null,
  slot_duration_minutes  int not null check (slot_duration_minutes between 5 and 480),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  check (end_time > start_time),
  foreign key (staff_id, branch_id, organization_id)
    references animal.staff_branches (staff_id, branch_id, organization_id) on delete cascade
);

create index schedules_staff_day_idx on animal.schedules (staff_id, day_of_week);
create index schedules_branch_idx on animal.schedules (branch_id);

-- ── Especies y razas ─────────────────────────────────────────
-- organization_id null = catálogo base compartido (solo lectura para las
-- organizaciones); con valor = agregada por esa organización.
create table animal.species (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references animal.organizations (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  created_at       timestamptz not null default now(),
  unique nulls not distinct (organization_id, name)
);

create table animal.breeds (
  id               uuid primary key default gen_random_uuid(),
  species_id       uuid not null references animal.species (id) on delete cascade,
  organization_id  uuid references animal.organizations (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  created_at       timestamptz not null default now(),
  unique nulls not distinct (species_id, organization_id, name),
  unique (id, species_id)
);

-- ── Catálogo de servicios ────────────────────────────────────
create table animal.services_catalog (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references animal.organizations (id) on delete cascade,
  category          animal.service_category not null,
  name              text not null check (length(trim(name)) > 0),
  description       text,
  price             numeric(12, 2) not null default 0 check (price >= 0),
  duration_minutes  int not null check (duration_minutes between 5 and 1440),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (organization_id, category, name)
);

-- ── Tutores y mascotas ───────────────────────────────────────
create table animal.clients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references animal.organizations (id) on delete cascade,
  national_id      text,                     -- RUT / DNI
  first_name       text not null check (length(trim(first_name)) > 0),
  last_name        text not null check (length(trim(last_name)) > 0),
  phone            text,
  email            text,
  address          text,
  created_at       timestamptz not null default now(),
  unique (organization_id, national_id),
  unique (id, organization_id)
);

create index clients_busqueda_idx on animal.clients (organization_id, last_name, first_name);

create table animal.pets (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null,
  organization_id   uuid not null,
  name              text not null check (length(trim(name)) > 0),
  species_id        uuid not null references animal.species (id),
  breed_id          uuid,
  birth_date        date check (birth_date <= current_date),
  weight            numeric(6, 2) check (weight > 0),   -- kg
  microchip_number  text,
  notes             text,
  created_at        timestamptz not null default now(),
  foreign key (client_id, organization_id) references animal.clients (id, organization_id) on delete cascade,
  -- La raza debe ser de la misma especie.
  foreign key (breed_id, species_id) references animal.breeds (id, species_id),
  unique (organization_id, microchip_number)
);

create index pets_client_idx on animal.pets (client_id);

-- ── Acceso: solo el backend ──────────────────────────────────
alter table animal.branches enable row level security;
alter table animal.staff_branches enable row level security;
alter table animal.schedules enable row level security;
alter table animal.species enable row level security;
alter table animal.breeds enable row level security;
alter table animal.services_catalog enable row level security;
alter table animal.clients enable row level security;
alter table animal.pets enable row level security;

revoke all on animal.branches, animal.staff_branches, animal.schedules, animal.species, animal.breeds,
  animal.services_catalog, animal.clients, animal.pets from anon, authenticated;
grant all on animal.branches, animal.staff_branches, animal.schedules, animal.species, animal.breeds,
  animal.services_catalog, animal.clients, animal.pets to service_role;

-- ── RPC: tutor + mascotas en una sola transacción ────────────
-- p_client: { national_id, first_name, last_name, phone, email, address }
-- p_pets:   [{ name, species_id, breed_id, birth_date, weight, microchip_number, notes }]
create function animal.create_client_with_pets(p_organization_id uuid, p_client jsonb, p_pets jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_client_id uuid;
  v_pet jsonb;
begin
  insert into animal.clients (organization_id, national_id, first_name, last_name, phone, email, address)
  values (
    p_organization_id,
    nullif(trim(p_client ->> 'national_id'), ''),
    trim(p_client ->> 'first_name'),
    trim(p_client ->> 'last_name'),
    nullif(trim(p_client ->> 'phone'), ''),
    nullif(lower(trim(p_client ->> 'email')), ''),
    nullif(trim(p_client ->> 'address'), '')
  )
  returning id into v_client_id;

  for v_pet in select * from jsonb_array_elements(coalesce(p_pets, '[]'::jsonb)) loop
    insert into animal.pets (client_id, organization_id, name, species_id, breed_id, birth_date, weight, microchip_number, notes)
    values (
      v_client_id,
      p_organization_id,
      trim(v_pet ->> 'name'),
      (v_pet ->> 'species_id')::uuid,
      nullif(v_pet ->> 'breed_id', '')::uuid,
      nullif(v_pet ->> 'birth_date', '')::date,
      nullif(v_pet ->> 'weight', '')::numeric,
      nullif(trim(v_pet ->> 'microchip_number'), ''),
      nullif(trim(v_pet ->> 'notes'), '')
    );
  end loop;

  return v_client_id;
end
$$;

revoke execute on function animal.create_client_with_pets(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function animal.create_client_with_pets(uuid, jsonb, jsonb) to service_role;

-- ── Datos base: especies y razas comunes ─────────────────────
with especies as (
  insert into animal.species (name) values ('Perro'), ('Gato')
  returning id, name
)
insert into animal.breeds (species_id, name)
select e.id, r.name
from especies e
join (values
  ('Perro', 'Mestizo'), ('Perro', 'Labrador Retriever'), ('Perro', 'Golden Retriever'),
  ('Perro', 'Pastor Alemán'), ('Perro', 'Poodle'), ('Perro', 'Bulldog Francés'),
  ('Perro', 'Beagle'), ('Perro', 'Chihuahua'), ('Perro', 'Yorkshire Terrier'),
  ('Perro', 'Schnauzer'), ('Perro', 'Shih Tzu'), ('Perro', 'Border Collie'),
  ('Perro', 'Dachshund'), ('Perro', 'Pug'), ('Perro', 'Cocker Spaniel'),
  ('Gato', 'Mestizo'), ('Gato', 'Persa'), ('Gato', 'Siamés'), ('Gato', 'Maine Coon'),
  ('Gato', 'Bengalí'), ('Gato', 'Británico de Pelo Corto'), ('Gato', 'Ragdoll')
) as r (especie, name) on r.especie = e.name;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- drop function if exists animal.create_client_with_pets(uuid, jsonb, jsonb);
-- drop table if exists animal.pets, animal.clients, animal.services_catalog,
--   animal.breeds, animal.species, animal.schedules, animal.staff_branches, animal.branches;
-- drop type if exists animal.service_category;
-- alter table animal.usuarios drop constraint if exists usuarios_id_organization_key;
-- alter table animal.usuarios drop column if exists specialty;
