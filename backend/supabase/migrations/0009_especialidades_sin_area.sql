-- ============================================================
-- Migration: 0009_especialidades_sin_area.sql
-- Description: Las especialidades dejan de tener área (category);
--   cualquier especialidad se puede asignar a cualquier rol o servicio.
--   La descripción pasa a ser obligatoria desde el backend (las filas
--   existentes sin descripción se completan al editarlas).
-- Date: 2026-10-12
-- Backward compatible: NO. Requiere el backend actualizado, que ya no
--   selecciona specialties.category.
-- ============================================================

alter table animal.specialties drop column category;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- alter table animal.specialties add column category animal.service_category;
