-- Tabla de usuarios para el login con Google.
create table if not exists public.usuarios (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  nombre        text,
  avatar_url    text,
  google_sub    text unique,
  rol           text not null default 'cliente' check (rol in ('admin', 'cliente')),
  activo        boolean not null default true,
  ultimo_login  timestamptz,
  created_at    timestamptz not null default now()
);

-- El backend accede con la service role key; nadie más debe leer esta tabla.
alter table public.usuarios enable row level security;
