-- ============================================================
-- Migration: 0002_organizations_profiles.sql
-- Description: Entidad prestadora (organizations) + perfiles ligados a
--   Supabase Auth (profiles), RLS y RPCs para la selección/asignación
--   de entidad. El perfil lo crea el backend al primer ingreso
--   (ensure_profile): auth.users es compartido con otras apps.
--   Acceso: solo el backend (service_role); el frontend no tiene keys.
-- Date: 2026-10-08
-- Backward compatible: YES (solo crea objetos; `usuarios` queda intacta
--   y deja de usarse; se puede eliminar en una migración posterior).
-- ============================================================

-- ── Schema ───────────────────────────────────────────────────
-- Debe agregarse a Settings > API > Exposed schemas para que el backend lo use.
create schema if not exists animal;
grant usage on schema animal to service_role;

-- ── Enums ────────────────────────────────────────────────────
create type animal.organization_type as enum ('PRIVATE_COMPANY', 'MUNICIPALITY', 'INDEPENDENT');
create type animal.user_role as enum ('SUPER_ADMIN', 'ORG_ADMIN', 'VET', 'GROOMER', 'TRAINER', 'CLIENT');

-- ── Tablas ───────────────────────────────────────────────────
create table animal.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  type        animal.organization_type not null,
  tax_id      text unique,                      -- RUT / RUC / NIT
  address     text,
  phone       text,
  email       text,
  -- Claves conocidas: public_signup (bool) = aparece en el directorio y
  -- cualquiera puede unirse como CLIENT.
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table animal.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  organization_id  uuid references animal.organizations (id) on delete set null,
  full_name        text,
  avatar_url       text,
  role             animal.user_role not null default 'CLIENT',
  phone            text,
  created_at       timestamptz not null default now()
);

create index profiles_organization_id_idx on animal.profiles (organization_id);

-- ── RLS ──────────────────────────────────────────────────────
-- Sin políticas = acceso denegado para anon/authenticated. Solo el backend
-- (service_role, que omite RLS) lee y escribe estas tablas.
alter table animal.organizations enable row level security;
alter table animal.profiles enable row level security;

revoke all on animal.organizations, animal.profiles from anon, authenticated;
grant all on animal.organizations, animal.profiles to service_role;

-- ── RPCs de asignación de entidad ────────────────────────────
-- Solo las ejecuta el backend (service_role): el frontend no tiene acceso
-- directo a la base. El backend valida el token y pasa el id del usuario
-- en p_actor_id; las reglas de autorización viven aquí.

-- Crea el perfil de Portal Canino la primera vez que el usuario entra.
-- auth.users es compartido con otras apps del proyecto: por eso no hay
-- trigger en auth.users; solo tiene perfil quien usa esta app.
-- El rol SIEMPRE nace CLIENT. p_organization_id (link de registro ?org=)
-- solo se respeta si esa organización admite registro público.
create function animal.ensure_profile(
  p_user_id uuid,
  p_full_name text default null,
  p_avatar_url text default null,
  p_organization_id uuid default null
)
returns animal.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_profile animal.profiles;
  v_org uuid := p_organization_id;
begin
  select * into v_profile from animal.profiles where id = p_user_id;
  if v_profile.id is not null then
    return v_profile;
  end if;

  if v_org is not null and not exists (
    select 1 from animal.organizations o
    where o.id = v_org and o.settings -> 'public_signup' = 'true'::jsonb
  ) then
    v_org := null;
  end if;

  insert into animal.profiles (id, organization_id, full_name, avatar_url, role)
  values (p_user_id, v_org, p_full_name, p_avatar_url, 'CLIENT')
  on conflict (id) do nothing;

  select * into v_profile from animal.profiles where id = p_user_id;
  return v_profile;
end
$$;

-- Directorio de organizaciones a las que cualquiera puede unirse.
-- Solo columnas públicas (no expone tax_id ni settings).
create function animal.list_public_organizations()
returns table (id uuid, name text, type animal.organization_type)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.type
  from animal.organizations o
  where o.settings -> 'public_signup' = 'true'::jsonb
  order by o.name
$$;

-- Usuario sin organización se une a una pública como CLIENT.
create function animal.join_organization(p_actor_id uuid, p_organization_id uuid)
returns animal.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_profile animal.profiles;
begin
  if not exists (
    select 1 from animal.organizations
    where id = p_organization_id and settings -> 'public_signup' = 'true'::jsonb
  ) then
    raise exception 'La organización no existe o no admite registro público' using errcode = 'P0001';
  end if;

  update animal.profiles
     set organization_id = p_organization_id, role = 'CLIENT'
   where id = p_actor_id and organization_id is null
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Tu cuenta ya pertenece a una organización' using errcode = 'P0001';
  end if;
  return v_profile;
end
$$;

-- Usuario sin organización crea la suya y queda como ORG_ADMIN.
-- Las municipalidades solo las da de alta un SUPER_ADMIN.
create function animal.create_organization(
  p_actor_id uuid,
  p_name text,
  p_type animal.organization_type,
  p_tax_id text default null,
  p_address text default null,
  p_phone text default null,
  p_email text default null
)
returns animal.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_actor animal.profiles;
  v_org animal.organizations;
begin
  select * into v_actor from animal.profiles where id = p_actor_id;
  if v_actor.id is null then
    raise exception 'Usuario sin perfil' using errcode = '42501';
  end if;
  if p_type = 'MUNICIPALITY' and v_actor.role <> 'SUPER_ADMIN' then
    raise exception 'Solo un super administrador puede registrar municipalidades' using errcode = '42501';
  end if;
  if v_actor.role <> 'SUPER_ADMIN' and v_actor.organization_id is not null then
    raise exception 'Tu cuenta ya pertenece a una organización' using errcode = 'P0001';
  end if;

  insert into animal.organizations (name, type, tax_id, address, phone, email)
  values (trim(p_name), p_type, nullif(trim(p_tax_id), ''), p_address, p_phone, p_email)
  returning * into v_org;

  -- El super admin crea organizaciones para otros; no se mueve a ellas.
  if v_actor.role <> 'SUPER_ADMIN' then
    update animal.profiles
       set organization_id = v_org.id, role = 'ORG_ADMIN'
     where id = p_actor_id;
  end if;
  return v_org;
end
$$;

-- Cambia rol (y, solo para SUPER_ADMIN, organización) de un usuario.
-- ORG_ADMIN: solo miembros de su org, sin tocarse a sí mismo ni dar SUPER_ADMIN.
create function animal.assign_profile(
  p_actor_id uuid,
  p_user_id uuid,
  p_role animal.user_role,
  p_organization_id uuid default null
)
returns animal.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_actor animal.profiles;
  v_target animal.profiles;
begin
  select * into v_actor from animal.profiles where id = p_actor_id;
  select * into v_target from animal.profiles where id = p_user_id;
  if v_target.id is null then
    raise exception 'Usuario no encontrado' using errcode = 'P0001';
  end if;

  if v_actor.role = 'SUPER_ADMIN' then
    update animal.profiles
       set role = p_role,
           organization_id = coalesce(p_organization_id, organization_id)
     where id = p_user_id
    returning * into v_target;
    return v_target;
  end if;

  if v_actor.role is distinct from 'ORG_ADMIN'
     or v_actor.organization_id is null
     or v_target.organization_id is distinct from v_actor.organization_id
     or (p_organization_id is not null and p_organization_id <> v_actor.organization_id)
     or p_user_id = p_actor_id
     or p_role = 'SUPER_ADMIN'
     or v_target.role = 'SUPER_ADMIN' then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  update animal.profiles set role = p_role where id = p_user_id
  returning * into v_target;
  return v_target;
end
$$;

revoke execute on function
  animal.ensure_profile(uuid, text, text, uuid),
  animal.list_public_organizations(),
  animal.join_organization(uuid, uuid),
  animal.create_organization(uuid, text, animal.organization_type, text, text, text, text),
  animal.assign_profile(uuid, uuid, animal.user_role, uuid)
from public, anon, authenticated;

grant execute on function
  animal.ensure_profile(uuid, text, text, uuid),
  animal.list_public_organizations(),
  animal.join_organization(uuid, uuid),
  animal.create_organization(uuid, text, animal.organization_type, text, text, text, text),
  animal.assign_profile(uuid, uuid, animal.user_role, uuid)
to service_role;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- drop function if exists animal.assign_profile(uuid, uuid, animal.user_role, uuid);
-- drop function if exists animal.create_organization(uuid, text, animal.organization_type, text, text, text, text);
-- drop function if exists animal.join_organization(uuid, uuid);
-- drop function if exists animal.list_public_organizations();
-- drop function if exists animal.ensure_profile(uuid, text, text, uuid);
-- drop table if exists animal.profiles;
-- drop table if exists animal.organizations;
-- (el schema animal no se elimina: contiene otras tablas)
-- drop type if exists animal.user_role;
-- drop type if exists animal.organization_type;
