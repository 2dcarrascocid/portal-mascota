-- ============================================================
-- Migration: 0012_atenciones_especialidad.sql
-- Description: Recepción. Especialidad de la atención (para listar y
--   filtrar las mascotas por especialidad). Con cita se copia la de la
--   cita; espontánea, la elige recepción. El backend valida que sea de la
--   organización y, si hay profesional, que la tenga asignada.
-- Date: 2026-10-17
-- Backward compatible: YES (solo agrega una columna nullable).
-- Requiere: 0011_recepcion_atenciones.sql
-- ============================================================

alter table animal.visits
  add column if not exists specialty_id uuid references animal.specialties (id) on delete set null;

-- Las atenciones ya recibidas desde una cita toman su especialidad.
update animal.visits vi
   set specialty_id = a.specialty_id
  from animal.appointments a
 where vi.appointment_id = a.id
   and vi.specialty_id is null
   and a.specialty_id is not null;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- alter table animal.visits drop column if exists specialty_id;
