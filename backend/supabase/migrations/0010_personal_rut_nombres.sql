-- ============================================================
-- Migration: 0010_personal_rut_nombres.sql
-- Description: Mantenedor de personal.
--   * Nombres y apellidos por separado (first_name / last_name). full_name
--     se conserva (lo usan correos, sesión y agendas) y el backend lo
--     compone al guardar. Se completa desde full_name existente.
--   * RUT chileno único (formato canónico 12345678-9, validado en backend).
--   * Cargo genérico STAFF: el personal ya no se crea con cargo
--     (veterinario, peluquero...); lo que hace sale de sus especialidades y
--     lo que puede hacer, de su rol de permisos. VET/GROOMER/TRAINER siguen
--     siendo válidos para el personal existente.
-- Date: 2026-10-13
-- Backward compatible: YES (solo agrega columnas, índice y valor de enum).
-- ============================================================

alter type animal.user_role add value if not exists 'STAFF';

alter table animal.usuarios
  add column if not exists first_name text,
  add column if not exists last_name  text,
  add column if not exists rut        text check (rut ~ '^[0-9]{7,8}-[0-9K]$');

create unique index if not exists usuarios_rut_key on animal.usuarios (rut) where rut is not null;
create index if not exists usuarios_org_apellidos_idx on animal.usuarios (organization_id, last_name, first_name);

-- Backfill: con 4 o más palabras, 2 nombres + apellidos; si no, 1 nombre + el resto.
update animal.usuarios u
   set first_name = case when array_length(p.w, 1) >= 4 then array_to_string(p.w[1:2], ' ') else p.w[1] end,
       last_name  = nullif(case when array_length(p.w, 1) >= 4
                                then array_to_string(p.w[3:], ' ')
                                else array_to_string(p.w[2:], ' ') end, '')
  from (select id, regexp_split_to_array(trim(full_name), '\s+') as w
          from animal.usuarios
         where full_name is not null and trim(full_name) <> '') p
 where u.id = p.id
   and u.first_name is null;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- drop index if exists animal.usuarios_org_apellidos_idx;
-- drop index if exists animal.usuarios_rut_key;
-- alter table animal.usuarios drop column if exists rut,
--   drop column if exists last_name, drop column if exists first_name;
-- (el valor 'STAFF' del enum no se puede quitar; reasignar antes:
--  update animal.usuarios set role = 'VET' where role = 'STAFF';)
