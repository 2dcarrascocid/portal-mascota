-- ============================================================
-- Migration: 0003_usuarios_propios.sql
-- Description: Autenticación propia de Portal Canino. Reemplaza
--   animal.profiles (ligada a auth.users, que es compartido con otras
--   apps del proyecto) por animal.usuarios con credenciales propias,
--   sesiones (refresh tokens) y tokens de verificación/recuperación.
--   Supabase Auth deja de usarse; Supabase queda solo como base de datos.
-- Date: 2026-10-08
-- Backward compatible: NO. Elimina animal.profiles (sin datos reales al
--   momento de escribirla). Requiere deploy coordinado del backend.
-- ============================================================

-- ── Quitar el modelo anterior (ligado a Supabase Auth) ───────
drop function if exists animal.ensure_profile(uuid, text, text, uuid);
drop function if exists animal.assign_profile(uuid, uuid, animal.user_role, uuid);
drop function if exists animal.create_organization(uuid, text, animal.organization_type, text, text, text, text);
drop function if exists animal.join_organization(uuid, uuid);
drop table if exists animal.profiles;

-- ── Usuarios ─────────────────────────────────────────────────
create table animal.usuarios (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null unique check (email = lower(email) and position('@' in email) > 1),
  password_hash        text,                 -- null si solo entra con Google/Facebook
  full_name            text,
  avatar_url           text,
  phone                text,
  google_sub           text unique,
  facebook_id          text unique,
  email_verificado_at  timestamptz,
  role                 animal.user_role not null default 'CLIENT',
  organization_id      uuid references animal.organizations (id) on delete set null,
  activo               boolean not null default true,
  intentos_fallidos    int not null default 0,
  bloqueado_hasta      timestamptz,
  ultimo_login         timestamptz,
  created_at           timestamptz not null default now()
);

create index usuarios_organization_id_idx on animal.usuarios (organization_id);

-- Refresh tokens (se guarda solo su hash SHA-256). Se rotan en cada refresh.
create table animal.sesiones (
  id                  uuid primary key default gen_random_uuid(),
  usuario_id          uuid not null references animal.usuarios (id) on delete cascade,
  refresh_token_hash  text not null unique,
  expira_at           timestamptz not null,
  revocada_at         timestamptz,
  user_agent          text,
  created_at          timestamptz not null default now()
);

create index sesiones_usuario_id_idx on animal.sesiones (usuario_id);

-- Tokens de un solo uso enviados por correo (solo su hash SHA-256).
create table animal.tokens_usuario (
  token_hash  text primary key,
  usuario_id  uuid not null references animal.usuarios (id) on delete cascade,
  tipo        text not null check (tipo in ('verificar_email', 'restablecer_password')),
  expira_at   timestamptz not null,
  usado_at    timestamptz,
  created_at  timestamptz not null default now()
);

create index tokens_usuario_usuario_id_idx on animal.tokens_usuario (usuario_id);

-- ── RLS: solo el backend (service_role) ──────────────────────
alter table animal.usuarios enable row level security;
alter table animal.sesiones enable row level security;
alter table animal.tokens_usuario enable row level security;

revoke all on animal.usuarios, animal.sesiones, animal.tokens_usuario from anon, authenticated;
grant all on animal.usuarios, animal.sesiones, animal.tokens_usuario to service_role;

-- ── RPCs de asignación de entidad (ahora sobre usuarios) ─────
-- El backend valida la sesión y pasa el id del usuario en p_actor_id.

-- Usuario sin organización se une a una pública como CLIENT.
create function animal.join_organization(p_actor_id uuid, p_organization_id uuid)
returns animal.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  v_usuario animal.usuarios;
begin
  if not exists (
    select 1 from animal.organizations
    where id = p_organization_id and settings -> 'public_signup' = 'true'::jsonb
  ) then
    raise exception 'La organización no existe o no admite registro público' using errcode = 'P0001';
  end if;

  update animal.usuarios
     set organization_id = p_organization_id, role = 'CLIENT'
   where id = p_actor_id and organization_id is null
  returning * into v_usuario;

  if v_usuario.id is null then
    raise exception 'Tu cuenta ya pertenece a una organización' using errcode = 'P0001';
  end if;
  return v_usuario;
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
  v_actor animal.usuarios;
  v_org animal.organizations;
begin
  select * into v_actor from animal.usuarios where id = p_actor_id;
  if v_actor.id is null then
    raise exception 'Usuario no encontrado' using errcode = '42501';
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
    update animal.usuarios
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
returns animal.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  v_actor animal.usuarios;
  v_target animal.usuarios;
begin
  select * into v_actor from animal.usuarios where id = p_actor_id;
  select * into v_target from animal.usuarios where id = p_user_id;
  if v_target.id is null then
    raise exception 'Usuario no encontrado' using errcode = 'P0001';
  end if;

  if v_actor.role = 'SUPER_ADMIN' then
    update animal.usuarios
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

  update animal.usuarios set role = p_role where id = p_user_id
  returning * into v_target;
  return v_target;
end
$$;

revoke execute on function
  animal.join_organization(uuid, uuid),
  animal.create_organization(uuid, text, animal.organization_type, text, text, text, text),
  animal.assign_profile(uuid, uuid, animal.user_role, uuid)
from public, anon, authenticated;

grant execute on function
  animal.join_organization(uuid, uuid),
  animal.create_organization(uuid, text, animal.organization_type, text, text, text, text),
  animal.assign_profile(uuid, uuid, animal.user_role, uuid)
to service_role;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- drop function if exists animal.assign_profile(uuid, uuid, animal.user_role, uuid);
-- drop function if exists animal.create_organization(uuid, text, animal.organization_type, text, text, text, text);
-- drop function if exists animal.join_organization(uuid, uuid);
-- drop table if exists animal.tokens_usuario;
-- drop table if exists animal.sesiones;
-- drop table if exists animal.usuarios;
-- (luego volver a ejecutar las secciones de profiles/RPCs de 0002)
