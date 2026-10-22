-- ============================================================
-- Migration: 0016_reagendar_cita.sql
-- Description: Reagendamiento de citas desde la contactabilidad (p. ej.
--   el tutor elige otra hora desde el enlace de un correo).
--   * appointments.rescheduled_from: la cita nueva apunta a la que reemplaza.
--   * contact_events admite la acción REAGENDAR.
--   * reschedule_appointment(): cancela la cita original y crea la nueva en
--     una transacción. Si el turno nuevo ya está tomado, el índice
--     appointments_turno_unico aborta todo y la cita original no se toca.
-- Date: 2026-10-21
-- Backward compatible: YES (columna nullable, check ampliado, función nueva).
-- Requiere: 0015_integracion_contactabilidad.sql
-- ============================================================

alter table animal.appointments
  add column if not exists rescheduled_from uuid references animal.appointments (id) on delete set null;

create index if not exists appointments_rescheduled_from_idx
  on animal.appointments (rescheduled_from) where rescheduled_from is not null;

alter table animal.contact_events drop constraint if exists contact_events_action_check;
alter table animal.contact_events
  add constraint contact_events_action_check check (action in ('ESTADO', 'LIBERAR', 'REAGENDAR'));

-- ── RPC: reagendar ───────────────────────────────────────────
-- Solo citas RESERVADA o CONFIRMADA, futuras y no pagadas en línea (la
-- condición va en el update, igual que en la liberación). La nueva hora la
-- eligió el tutor, así que nace CONFIRMADA. Que el turno exista en la
-- programación y el profesional atienda ese servicio lo valida el backend.
-- Devuelve el id de la cita nueva, o null si la original ya no cumple las
-- condiciones.
create function animal.reschedule_appointment(
  p_appointment_id uuid,
  p_organization_id uuid,
  p_staff_id uuid,
  p_date date,
  p_start_time time,
  p_end_time time,
  p_channel text,
  p_today date,
  p_now_time time
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_cita animal.appointments;
  v_nueva uuid;
begin
  if p_date < p_today or (p_date = p_today and p_start_time <= p_now_time) then
    raise exception 'La nueva hora ya pasó';
  end if;

  update animal.appointments
     set status = 'CANCELADA',
         cancel_reason = 'Reagendada por el tutor (contactabilidad)',
         updated_at = now()
   where id = p_appointment_id
     and organization_id = p_organization_id
     and status in ('RESERVADA', 'CONFIRMADA')
     and coalesce(payment_status, '') <> 'PAGADO'
     and (date > p_today or (date = p_today and start_time > p_now_time))
  returning * into v_cita;
  if not found then return null; end if;

  insert into animal.appointments (
    organization_id, branch_id, staff_id, date, start_time, end_time, service_id, specialty_id,
    client_id, pet_id, contact_name, contact_phone, contact_email, notes, status,
    confirmed_at, confirmation_channel, rescheduled_from
  )
  values (
    v_cita.organization_id, v_cita.branch_id, p_staff_id, p_date, p_start_time, p_end_time,
    v_cita.service_id, v_cita.specialty_id, v_cita.client_id, v_cita.pet_id,
    v_cita.contact_name, v_cita.contact_phone, v_cita.contact_email, v_cita.notes, 'CONFIRMADA',
    now(), p_channel, v_cita.id
  )
  returning id into v_nueva;

  return v_nueva;
end
$$;

revoke execute on function animal.reschedule_appointment(uuid, uuid, uuid, date, time, time, text, date, time) from public, anon, authenticated;
grant execute on function animal.reschedule_appointment(uuid, uuid, uuid, date, time, time, text, date, time) to service_role;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- drop function if exists animal.reschedule_appointment(uuid, uuid, uuid, date, time, time, text, date, time);
-- alter table animal.contact_events drop constraint if exists contact_events_action_check;
-- alter table animal.contact_events add constraint contact_events_action_check check (action in ('ESTADO', 'LIBERAR'));
-- drop index if exists animal.appointments_rescheduled_from_idx;
-- alter table animal.appointments drop column if exists rescheduled_from;
