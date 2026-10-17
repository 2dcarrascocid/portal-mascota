-- ============================================================
-- Migration: 0011_recepcion_atenciones.sql
-- Description: Módulo Recepción. Una atención (visits) empieza cuando la
--   mascota llega: desde una cita agendada (appointment_id) o espontánea
--   (sin cita). Flujo: llegada -> observaciones -> prestaciones
--   (visit_items) -> pago (visit_payments) -> cierre.
--   * Nuevo estado de cita LLEGO (en recepción); al cerrar pasa a ATENDIDA.
--   * Teléfonos solo con dígitos (columnas generadas) para buscar por
--     teléfono aunque se hayan escrito con espacios, guiones o +56.
--   Acceso: solo el backend (service_role), igual que el resto del esquema.
-- Date: 2026-10-17
-- Backward compatible: YES (solo agrega tablas, columnas generadas y un
--   valor de enum).
-- Requiere: 0008_citas.sql
-- ============================================================

alter type animal.appointment_status add value if not exists 'LLEGO' after 'CONFIRMADA';

-- ── Búsqueda por teléfono ────────────────────────────────────
alter table animal.clients
  add column if not exists phone_digits text generated always as (regexp_replace(coalesce(phone, ''), '\D', '', 'g')) stored;
alter table animal.appointments
  add column if not exists contact_phone_digits text generated always as (regexp_replace(coalesce(contact_phone, ''), '\D', '', 'g')) stored;

create index if not exists pets_org_nombre_idx on animal.pets (organization_id, lower(name));

-- ── Atenciones ───────────────────────────────────────────────
create type animal.visit_status as enum ('ABIERTA', 'CERRADA', 'ANULADA');
create type animal.payment_method as enum ('EFECTIVO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA');

create table animal.visits (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references animal.organizations (id) on delete cascade,
  branch_id        uuid not null,
  -- null = atención espontánea (sin cita).
  appointment_id   uuid references animal.appointments (id) on delete set null,
  date             date not null,                  -- día local de la llegada
  arrived_at       timestamptz not null default now(),
  -- Profesional que atiende (opcional). Sin FK compuesta: es historia.
  staff_id         uuid references animal.usuarios (id) on delete set null,
  client_id        uuid,
  pet_id           uuid references animal.pets (id) on delete set null,
  -- Copias para que la atención conserve a quién se atendió aunque se borre
  -- la ficha, y para atender sin ficha.
  contact_name     text not null check (length(trim(contact_name)) > 0),
  contact_phone    text,
  pet_name         text,
  observations     text,
  status           animal.visit_status not null default 'ABIERTA',
  closed_at        timestamptz,
  closed_by        uuid references animal.usuarios (id) on delete set null,
  cancel_reason    text,
  created_by       uuid references animal.usuarios (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id),
  check ((status = 'CERRADA') = (closed_at is not null)),
  foreign key (branch_id, organization_id) references animal.branches (id, organization_id) on delete cascade,
  foreign key (client_id, organization_id) references animal.clients (id, organization_id) on delete set null (client_id),
  foreign key (pet_id, client_id) references animal.pets (id, client_id)
);

-- Una cita llega una sola vez (anular la atención la libera).
create unique index visits_cita_unica on animal.visits (appointment_id)
  where appointment_id is not null and status <> 'ANULADA';

create index visits_fecha_idx on animal.visits (organization_id, date, branch_id);
create index visits_client_idx on animal.visits (client_id);
create index visits_pet_idx on animal.visits (pet_id);

-- ── Prestaciones (servicios realizados) ──────────────────────
-- description y unit_price se copian del catálogo al cargarlas: el cobro no
-- cambia si después se edita el precio o se borra el servicio.
create table animal.visit_items (
  id               uuid primary key default gen_random_uuid(),
  visit_id         uuid not null,
  organization_id  uuid not null,
  service_id       uuid references animal.services_catalog (id) on delete set null,
  description      text not null check (length(trim(description)) > 0),
  quantity         int not null default 1 check (quantity between 1 and 999),
  unit_price       numeric(12, 2) not null check (unit_price >= 0),
  staff_id         uuid references animal.usuarios (id) on delete set null,
  created_by       uuid references animal.usuarios (id) on delete set null,
  created_at       timestamptz not null default now(),
  foreign key (visit_id, organization_id) references animal.visits (id, organization_id) on delete cascade
);

create index visit_items_visit_idx on animal.visit_items (visit_id);

-- ── Pagos (se admite pago dividido en varios medios) ─────────
create table animal.visit_payments (
  id               uuid primary key default gen_random_uuid(),
  visit_id         uuid not null,
  organization_id  uuid not null,
  method           animal.payment_method not null,
  amount           numeric(12, 2) not null check (amount > 0),
  reference        text,                           -- n° de voucher / transferencia
  created_by       uuid references animal.usuarios (id) on delete set null,
  created_at       timestamptz not null default now(),
  foreign key (visit_id, organization_id) references animal.visits (id, organization_id) on delete cascade
);

create index visit_payments_visit_idx on animal.visit_payments (visit_id);

-- ── Acceso: solo el backend ──────────────────────────────────
alter table animal.visits enable row level security;
alter table animal.visit_items enable row level security;
alter table animal.visit_payments enable row level security;

revoke all on animal.visits, animal.visit_items, animal.visit_payments from anon, authenticated;
grant all on animal.visits, animal.visit_items, animal.visit_payments to service_role;

-- ── RPC: cerrar la atención ──────────────────────────────────
-- En una transacción: exige al menos una prestación y el total pagado; cierra
-- la atención y deja la cita (si la hay) como ATENDIDA.
create function animal.close_visit(p_visit_id uuid, p_organization_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_visit animal.visits;
  v_total numeric;
  v_pagado numeric;
begin
  select * into v_visit from animal.visits
   where id = p_visit_id and organization_id = p_organization_id
   for update;
  if not found then raise exception 'Atención no encontrada'; end if;
  if v_visit.status <> 'ABIERTA' then raise exception 'La atención ya no está abierta'; end if;

  select coalesce(sum(quantity * unit_price), 0) into v_total
    from animal.visit_items where visit_id = p_visit_id;
  if not exists (select 1 from animal.visit_items where visit_id = p_visit_id) then
    raise exception 'Carga al menos una prestación antes de cerrar';
  end if;

  select coalesce(sum(amount), 0) into v_pagado from animal.visit_payments where visit_id = p_visit_id;
  if v_pagado < v_total then
    raise exception 'Falta registrar el pago: saldo pendiente %', v_total - v_pagado;
  end if;

  update animal.visits
     set status = 'CERRADA', closed_at = now(), closed_by = p_user_id, updated_at = now()
   where id = p_visit_id;

  if v_visit.appointment_id is not null then
    update animal.appointments set status = 'ATENDIDA', updated_at = now() where id = v_visit.appointment_id;
  end if;
end
$$;

revoke execute on function animal.close_visit(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function animal.close_visit(uuid, uuid, uuid) to service_role;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- drop function if exists animal.close_visit(uuid, uuid, uuid);
-- drop table if exists animal.visit_payments, animal.visit_items, animal.visits;
-- drop type if exists animal.payment_method;
-- drop type if exists animal.visit_status;
-- drop index if exists animal.pets_org_nombre_idx;
-- alter table animal.appointments drop column if exists contact_phone_digits;
-- alter table animal.clients drop column if exists phone_digits;
-- (el valor 'LLEGO' del enum no se puede quitar; reasignar antes:
--  update animal.appointments set status = 'ATENDIDA' where status = 'LLEGO';)
