-- ============================================================
-- Migration: 0014_portal_tutor.sql
-- Description: Portal del tutor (usuario con rol CLIENT, entra con Google).
--   * tutor_profiles: datos del tutor y su dirección geolocalizada (para
--     buscar las sucursales más cercanas). Es global: no pertenece a una
--     organización.
--   * tutor_pets: las mascotas que mantiene el propio tutor (catálogo base
--     de especies/razas, el que comparten todas las organizaciones).
--   * Vínculo con las fichas de cada organización: al reservar en una
--     organización se crea (o se reutiliza) su ficha clients/pets y queda
--     enlazada (clients.usuario_id, pets.tutor_pet_id). Así el tutor ve su
--     historial en todas las entidades donde se atendió.
--   * Pago en línea de la reserva (Webpay): online_payments + estado de pago
--     en la cita. La cita impaga retiene el turno hasta payment_expires_at;
--     vencida, release_expired_bookings() la cancela y libera el turno.
--   Acceso: solo el backend (service_role), igual que el resto del esquema.
-- Date: 2026-10-18
-- Backward compatible: YES (solo agrega tablas, columnas nullable y una
--   función).
-- Requiere: 0013_caja_cierre_diario.sql
-- ============================================================

-- ── Perfil del tutor ─────────────────────────────────────────
create table animal.tutor_profiles (
  usuario_id   uuid primary key references animal.usuarios (id) on delete cascade,
  national_id  text unique,                 -- RUT canónico '12345678-9'
  first_name   text,
  last_name    text,
  phone        text,
  address      text,
  city         text,
  region       text,
  latitude     numeric(9, 6) check (latitude between -90 and 90),
  longitude    numeric(9, 6) check (longitude between -180 and 180),
  updated_at   timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);

-- ── Mascotas del tutor ───────────────────────────────────────
create table animal.tutor_pets (
  id                uuid primary key default gen_random_uuid(),
  usuario_id        uuid not null references animal.usuarios (id) on delete cascade,
  name              text not null check (length(trim(name)) > 0),
  species_id        uuid not null references animal.species (id),
  breed_id          uuid,
  birth_date        date check (birth_date <= current_date),
  weight            numeric(6, 2) check (weight > 0),
  microchip_number  text unique,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (breed_id, species_id) references animal.breeds (id, species_id)
);

create index tutor_pets_usuario_idx on animal.tutor_pets (usuario_id);

-- ── Vínculo con las fichas de cada organización ──────────────
alter table animal.clients
  add column if not exists usuario_id uuid references animal.usuarios (id) on delete set null,
  add constraint clients_org_usuario_key unique (organization_id, usuario_id);

alter table animal.pets
  add column if not exists tutor_pet_id uuid references animal.tutor_pets (id) on delete set null,
  add constraint pets_org_tutor_pet_key unique (organization_id, tutor_pet_id);

create index if not exists clients_usuario_idx on animal.clients (usuario_id);

-- ── Pago en línea de la cita ─────────────────────────────────
-- null = sin pago en línea (reservada por la recepción o servicio sin costo).
alter table animal.appointments
  add column if not exists payment_status text check (payment_status in ('PENDIENTE', 'PAGADO')),
  add column if not exists payment_amount numeric(12, 2) check (payment_amount >= 0),
  add column if not exists payment_expires_at timestamptz;

create index if not exists appointments_pago_pendiente_idx
  on animal.appointments (payment_expires_at) where payment_status = 'PENDIENTE';

create table animal.online_payments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references animal.organizations (id) on delete cascade,
  appointment_id      uuid references animal.appointments (id) on delete set null,
  usuario_id          uuid references animal.usuarios (id) on delete set null,
  buy_order           text not null unique,
  token               text unique,
  amount              numeric(12, 2) not null check (amount > 0),
  status              text not null default 'PENDIENTE'
                      check (status in ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'ANULADO')),
  authorization_code  text,
  card_last_digits    text,
  response            jsonb,
  -- La reserva venció antes de que llegara la confirmación y el turno ya se
  -- tomó: el pago quedó aprobado sin cita y hay que devolverlo.
  requires_refund     boolean not null default false,
  created_at          timestamptz not null default now(),
  confirmed_at        timestamptz
);

create index online_payments_appointment_idx on animal.online_payments (appointment_id);
create index online_payments_usuario_idx on animal.online_payments (usuario_id);

-- ── Liberar reservas impagas vencidas ────────────────────────
-- La llama el backend antes de calcular turnos libres y de reservar.
create function animal.release_expired_bookings()
returns int
language sql security definer set search_path = '' as $$
  with liberadas as (
    update animal.appointments
       set status = 'CANCELADA',
           cancel_reason = 'Pago en línea no completado',
           payment_status = null,
           updated_at = now()
     where payment_status = 'PENDIENTE'
       and payment_expires_at < now()
       and status <> 'CANCELADA'
    returning 1
  )
  select count(*)::int from liberadas;
$$;

-- ── Acceso: solo el backend ──────────────────────────────────
alter table animal.tutor_profiles enable row level security;
alter table animal.tutor_pets enable row level security;
alter table animal.online_payments enable row level security;

revoke all on animal.tutor_profiles, animal.tutor_pets, animal.online_payments from anon, authenticated;
grant all on animal.tutor_profiles, animal.tutor_pets, animal.online_payments to service_role;

revoke execute on function animal.release_expired_bookings() from public, anon, authenticated;
grant execute on function animal.release_expired_bookings() to service_role;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- drop function if exists animal.release_expired_bookings();
-- drop table if exists animal.online_payments;
-- drop index if exists animal.appointments_pago_pendiente_idx;
-- alter table animal.appointments
--   drop column if exists payment_expires_at, drop column if exists payment_amount,
--   drop column if exists payment_status;
-- alter table animal.pets drop constraint if exists pets_org_tutor_pet_key, drop column if exists tutor_pet_id;
-- drop index if exists animal.clients_usuario_idx;
-- alter table animal.clients drop constraint if exists clients_org_usuario_key, drop column if exists usuario_id;
-- drop table if exists animal.tutor_pets, animal.tutor_profiles;
