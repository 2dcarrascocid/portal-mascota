-- ============================================================
-- Migration: 0015_integracion_contactabilidad.sql
-- Description: Integración con un sistema externo de contactabilidad
--   (motor de confirmación de citas por WhatsApp/voz/SMS) vía la API
--   /api/v1 del Core.
--   * integration_clients: credenciales OAuth2 (client credentials) por
--     organización. Del secreto solo se guarda su hash.
--   * Trazabilidad de la confirmación en la cita (confirmed_at, canal).
--   * contact_events: bitácora de cada acción del motor sobre una cita;
--     external_id único por credencial = idempotencia de reintentos.
--   * waitlist_slots: cupos liberados por falta de confirmación, que entran
--     a la lista de espera. El turno en sí queda libre al pasar la cita a
--     CANCELADA (índice parcial appointments_turno_unico).
--   * release_appointment_to_waitlist(): libera la cita y registra el cupo
--     en una transacción.
-- Date: 2026-10-20
-- Backward compatible: YES (solo agrega tablas, columnas nullable y una
--   función).
-- Requiere: 0014_portal_tutor.sql
-- ============================================================

-- ── Credenciales inter-sistema ───────────────────────────────
create table animal.integration_clients (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references animal.organizations (id) on delete cascade,
  name                text not null check (length(trim(name)) > 0),
  client_id           text not null unique,
  client_secret_hash  text not null,            -- sha256 del secreto (alta entropía)
  created_by          uuid references animal.usuarios (id) on delete set null,
  created_at          timestamptz not null default now(),
  last_used_at        timestamptz,
  revoked_at          timestamptz,
  unique (id, organization_id)
);

create index integration_clients_org_idx on animal.integration_clients (organization_id);

-- ── Trazabilidad de la confirmación en la cita ───────────────
alter table animal.appointments
  add column if not exists confirmed_at          timestamptz,
  add column if not exists confirmation_channel  text
    check (confirmation_channel in ('WHATSAPP', 'SMS', 'EMAIL', 'VOZ', 'LLAMADA', 'PRESENCIAL', 'PORTAL', 'MANUAL'));

-- ── Bitácora de acciones del motor ───────────────────────────
create table animal.contact_events (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references animal.organizations (id) on delete cascade,
  appointment_id         uuid references animal.appointments (id) on delete set null,
  integration_client_id  uuid references animal.integration_clients (id) on delete set null,
  action                 text not null check (action in ('ESTADO', 'LIBERAR')),
  engine_result          text,                  -- código del motor (ver matriz de estados)
  channel                text,
  external_id            text,                  -- id del evento en el motor
  previous_status        animal.appointment_status,
  new_status             animal.appointment_status,
  created_at             timestamptz not null default now(),
  unique (integration_client_id, external_id)
);

create index contact_events_appointment_idx on animal.contact_events (appointment_id);

-- ── Cupos liberados (lista de espera) ────────────────────────
create table animal.waitlist_slots (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references animal.organizations (id) on delete cascade,
  branch_id              uuid not null,
  staff_id               uuid not null references animal.usuarios (id),
  date                   date not null,
  start_time             time not null,
  end_time               time not null,
  service_id             uuid references animal.services_catalog (id) on delete set null,
  specialty_id           uuid references animal.specialties (id) on delete set null,
  -- Una cita libera su cupo una sola vez (idempotencia de /liberar).
  released_appointment_id uuid not null unique references animal.appointments (id) on delete cascade,
  reason                 text,
  released_at            timestamptz not null default now(),
  foreign key (branch_id, organization_id) references animal.branches (id, organization_id) on delete cascade
);

create index waitlist_slots_fecha_idx on animal.waitlist_slots (organization_id, date);

-- ── RPC: liberar la cita e ingresar el cupo a la lista de espera ──
-- Solo citas RESERVADA, futuras y no pagadas en línea. La condición va en
-- el update (no en una lectura previa) para que una respuesta concurrente
-- del tutor no se pise. Devuelve el id del cupo, o null si la cita ya no
-- cumple las condiciones (el backend responde 409 con el detalle).
create function animal.release_appointment_to_waitlist(
  p_appointment_id uuid,
  p_organization_id uuid,
  p_reason text,
  p_today date,
  p_now_time time
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_cita animal.appointments;
  v_slot uuid;
begin
  update animal.appointments
     set status = 'CANCELADA',
         cancel_reason = p_reason,
         updated_at = now()
   where id = p_appointment_id
     and organization_id = p_organization_id
     and status = 'RESERVADA'
     and coalesce(payment_status, '') <> 'PAGADO'
     and (date > p_today or (date = p_today and start_time > p_now_time))
  returning * into v_cita;
  if not found then return null; end if;

  insert into animal.waitlist_slots
    (organization_id, branch_id, staff_id, date, start_time, end_time, service_id, specialty_id,
     released_appointment_id, reason)
  values
    (v_cita.organization_id, v_cita.branch_id, v_cita.staff_id, v_cita.date, v_cita.start_time,
     v_cita.end_time, v_cita.service_id, v_cita.specialty_id, v_cita.id, p_reason)
  returning id into v_slot;

  return v_slot;
end
$$;

-- ── Acceso: solo el backend ──────────────────────────────────
alter table animal.integration_clients enable row level security;
alter table animal.contact_events enable row level security;
alter table animal.waitlist_slots enable row level security;

revoke all on animal.integration_clients, animal.contact_events, animal.waitlist_slots from anon, authenticated;
grant all on animal.integration_clients, animal.contact_events, animal.waitlist_slots to service_role;

revoke execute on function animal.release_appointment_to_waitlist(uuid, uuid, text, date, time) from public, anon, authenticated;
grant execute on function animal.release_appointment_to_waitlist(uuid, uuid, text, date, time) to service_role;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- drop function if exists animal.release_appointment_to_waitlist(uuid, uuid, text, date, time);
-- drop table if exists animal.waitlist_slots, animal.contact_events, animal.integration_clients;
-- alter table animal.appointments
--   drop column if exists confirmation_channel, drop column if exists confirmed_at;
