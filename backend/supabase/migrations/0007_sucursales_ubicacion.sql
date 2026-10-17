-- ============================================================
-- Migration: 0007_sucursales_ubicacion.sql
-- Description: Posición geográfica de las sucursales (latitud/longitud
--   WGS84) más comuna/ciudad y región, para mostrarlas en el mapa y
--   buscar la más cercana. La geocodificación (dirección <-> coordenadas)
--   la hace el backend con OpenStreetMap/Nominatim (src/lib/geo.js).
-- Date: 2026-10-11
-- Backward compatible: YES (solo agrega columnas nullable).
-- Requiere: 0006_configuracion_roles_agendas.sql
-- ============================================================

alter table animal.branches
  add column if not exists latitude numeric(9, 6),
  add column if not exists longitude numeric(9, 6),
  add column if not exists city text,
  add column if not exists region text,
  add constraint branches_latitude_check check (latitude between -90 and 90),
  add constraint branches_longitude_check check (longitude between -180 and 180),
  -- Las dos coordenadas o ninguna.
  add constraint branches_coordenadas_check check ((latitude is null) = (longitude is null));

-- Búsqueda por comuna/ciudad dentro de la organización.
create index if not exists branches_city_idx on animal.branches (organization_id, lower(city));

-- ── DOWN (rollback manual) ───────────────────────────────────
-- drop index if exists animal.branches_city_idx;
-- alter table animal.branches
--   drop constraint if exists branches_coordenadas_check,
--   drop constraint if exists branches_longitude_check,
--   drop constraint if exists branches_latitude_check,
--   drop column if exists region, drop column if exists city,
--   drop column if exists longitude, drop column if exists latitude;
