-- ============================================================
-- Migration: 0013_caja_cierre_diario.sql
-- Description: Módulo Pagos y caja. Resumen de los pagos del día por
--   sucursal (cuadratura) y cierre diario de caja.
--   * Nuevos medios de pago: WEBPAY (pago por internet) y OTRO.
--   * Cada pago guarda su sucursal y su día local (date): la caja se cuadra
--     por el día en que se recibió el dinero, no por el día de la atención.
--   * cash_closures: un cierre por sucursal y día, con la foto de los
--     totales (esperado) y lo declarado en el arqueo (contado).
--   * Con la caja cerrada no se pueden agregar ni quitar pagos de ese día
--     (trigger); reabrir = borrar el cierre (lo hace el backend).
--   Categorías de la cuadratura:
--     efectivo = EFECTIVO · tarjeta = DEBITO, CREDITO
--     internet = TRANSFERENCIA, WEBPAY · otros = OTRO
--   Pendientes: atenciones no anuladas de la sucursal, de ese día o antes,
--   con saldo (prestaciones - pagos hasta ese día) mayor a 0.
--   Acceso: solo el backend (service_role), igual que el resto del esquema.
-- Date: 2026-10-18
-- Backward compatible: YES (agrega valores de enum, columnas con backfill,
--   una tabla y funciones). Los pagos existentes toman la sucursal de su
--   atención y su día en hora de Chile.
-- Requiere: 0011_recepcion_atenciones.sql
-- ============================================================

alter type animal.payment_method add value if not exists 'WEBPAY';
alter type animal.payment_method add value if not exists 'OTRO';

-- ── Sucursal y día de cada pago ──────────────────────────────
alter table animal.visit_payments
  add column if not exists branch_id uuid,
  add column if not exists date date;

update animal.visit_payments p
   set branch_id = vi.branch_id,
       date = (p.created_at at time zone 'America/Santiago')::date
  from animal.visits vi
 where vi.id = p.visit_id
   and (p.branch_id is null or p.date is null);

-- El backend envía el día local (ZONA_HORARIA); el default es el respaldo.
alter table animal.visit_payments
  alter column branch_id set not null,
  alter column date set not null,
  alter column date set default ((now() at time zone 'America/Santiago')::date),
  add constraint visit_payments_branch_fkey
    foreign key (branch_id, organization_id) references animal.branches (id, organization_id) on delete cascade;

create index if not exists visit_payments_caja_idx on animal.visit_payments (organization_id, branch_id, date);

-- ── Cierres de caja ──────────────────────────────────────────
create table animal.cash_closures (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references animal.organizations (id) on delete cascade,
  branch_id        uuid not null,
  date             date not null,
  -- Fondo con que partió la caja (sencillo); se suma al efectivo esperado.
  opening_cash     numeric(12, 2) not null default 0 check (opening_cash >= 0),
  -- Esperado = lo registrado en el sistema; contado = arqueo (null = no declarado).
  cash_expected    numeric(12, 2) not null,
  cash_counted     numeric(12, 2) check (cash_counted >= 0),
  card_expected    numeric(12, 2) not null,
  card_counted     numeric(12, 2) check (card_counted >= 0),
  online_expected  numeric(12, 2) not null,
  online_counted   numeric(12, 2) check (online_counted >= 0),
  other_expected   numeric(12, 2) not null,
  other_counted    numeric(12, 2) check (other_counted >= 0),
  total_collected  numeric(12, 2) not null,          -- pagos del día (sin el fondo)
  payments_count   int not null,
  pending_count    int not null,
  pending_amount   numeric(12, 2) not null,
  summary          jsonb not null,                   -- foto completa (por medio y pendientes)
  notes            text,
  closed_by        uuid references animal.usuarios (id) on delete set null,
  closed_at        timestamptz not null default now(),
  unique (branch_id, date),
  foreign key (branch_id, organization_id) references animal.branches (id, organization_id) on delete cascade
);

create index cash_closures_org_fecha_idx on animal.cash_closures (organization_id, date desc);

alter table animal.cash_closures enable row level security;
revoke all on animal.cash_closures from anon, authenticated;
grant all on animal.cash_closures to service_role;

-- Serializa los pagos y el cierre de una misma caja (sucursal + día).
create function animal.lock_cash_day(p_branch_id uuid, p_date date)
returns void
language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtext('caja:' || p_branch_id::text || ':' || p_date::text));
$$;

-- ── Trigger: sucursal del pago y caja cerrada ────────────────
create function animal.visit_payments_cash_check()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_branch uuid;
  v_date date;
begin
  if tg_op = 'INSERT' then
    new.branch_id := (select branch_id from animal.visits where id = new.visit_id);
    v_branch := new.branch_id;
    v_date := new.date;
  else
    -- Borrado en cascada (se borra la sucursal u organización): no se bloquea.
    if pg_trigger_depth() > 1 then return old; end if;
    v_branch := old.branch_id;
    v_date := old.date;
  end if;

  perform animal.lock_cash_day(v_branch, v_date);
  if exists (select 1 from animal.cash_closures where branch_id = v_branch and date = v_date) then
    raise exception 'La caja del % ya está cerrada: reábrela para modificar sus pagos', to_char(v_date, 'DD-MM-YYYY');
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger visit_payments_cash_check
  before insert or delete on animal.visit_payments
  for each row execute function animal.visit_payments_cash_check();

-- ── RPC: resumen del día (cuadratura) ────────────────────────
-- { by_method: { EFECTIVO: { count, amount }, ... }, cash, card, online, other,
--   total, count, pending: [{ visit_id, date, contact_name, pet_name, total, paid, balance }],
--   pending_count, pending_amount }
create function animal.cash_day_summary(p_organization_id uuid, p_branch_id uuid, p_date date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with pagos as (
    select method::text as method, amount
      from animal.visit_payments
     where organization_id = p_organization_id and branch_id = p_branch_id and date = p_date
  ),
  por_medio as (
    select method, count(*) as n, sum(amount) as monto from pagos group by method
  ),
  -- Candidatas a pendiente: abiertas o cerradas después de ese día (las
  -- cerradas antes quedaron pagadas). El saldo se calcula a ese día.
  saldos as (
    select vi.id, vi.date, vi.contact_name,
           coalesce(pe.name, vi.pet_name) as pet_name,
           coalesce((select sum(quantity * unit_price) from animal.visit_items where visit_id = vi.id), 0) as total,
           coalesce((select sum(amount) from animal.visit_payments where visit_id = vi.id and date <= p_date), 0) as pagado
      from animal.visits vi
      left join animal.pets pe on pe.id = vi.pet_id
     where vi.organization_id = p_organization_id
       and vi.branch_id = p_branch_id
       and vi.date <= p_date
       and vi.status <> 'ANULADA'
       and (vi.status = 'ABIERTA' or vi.closed_at >= p_date::timestamptz - interval '1 day')
  ),
  pendientes as (
    select * from saldos where total - pagado > 0
  )
  select jsonb_build_object(
    'by_method', coalesce((select jsonb_object_agg(method, jsonb_build_object('count', n, 'amount', monto)) from por_medio), '{}'::jsonb),
    'cash',   (select coalesce(sum(amount), 0) from pagos where method = 'EFECTIVO'),
    'card',   (select coalesce(sum(amount), 0) from pagos where method in ('DEBITO', 'CREDITO')),
    'online', (select coalesce(sum(amount), 0) from pagos where method in ('TRANSFERENCIA', 'WEBPAY')),
    'other',  (select coalesce(sum(amount), 0) from pagos where method not in ('EFECTIVO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'WEBPAY')),
    'total',  (select coalesce(sum(amount), 0) from pagos),
    'count',  (select count(*) from pagos),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
               'visit_id', id, 'date', date, 'contact_name', contact_name, 'pet_name', pet_name,
               'total', total, 'paid', pagado, 'balance', total - pagado
             ) order by date, contact_name)
        from pendientes), '[]'::jsonb),
    'pending_count',  (select count(*) from pendientes),
    'pending_amount', (select coalesce(sum(total - pagado), 0) from pendientes)
  );
$$;

-- ── RPC: cerrar la caja del día ──────────────────────────────
-- En una transacción y con la caja bloqueada: toma la foto del resumen y
-- registra el arqueo. Un solo cierre por sucursal y día.
create function animal.close_cash_day(
  p_organization_id uuid,
  p_branch_id uuid,
  p_date date,
  p_user_id uuid,
  p_opening_cash numeric,
  p_cash_counted numeric,
  p_card_counted numeric,
  p_online_counted numeric,
  p_other_counted numeric,
  p_notes text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_resumen jsonb;
  v_id uuid;
begin
  if not exists (select 1 from animal.branches where id = p_branch_id and organization_id = p_organization_id) then
    raise exception 'Sucursal no encontrada';
  end if;

  perform animal.lock_cash_day(p_branch_id, p_date);
  if exists (select 1 from animal.cash_closures where branch_id = p_branch_id and date = p_date) then
    raise exception 'La caja de ese día ya está cerrada';
  end if;

  v_resumen := animal.cash_day_summary(p_organization_id, p_branch_id, p_date);

  insert into animal.cash_closures (
    organization_id, branch_id, date, opening_cash,
    cash_expected, cash_counted, card_expected, card_counted,
    online_expected, online_counted, other_expected, other_counted,
    total_collected, payments_count, pending_count, pending_amount,
    summary, notes, closed_by
  ) values (
    p_organization_id, p_branch_id, p_date, coalesce(p_opening_cash, 0),
    coalesce(p_opening_cash, 0) + (v_resumen ->> 'cash')::numeric, p_cash_counted,
    (v_resumen ->> 'card')::numeric, p_card_counted,
    (v_resumen ->> 'online')::numeric, p_online_counted,
    (v_resumen ->> 'other')::numeric, p_other_counted,
    (v_resumen ->> 'total')::numeric, (v_resumen ->> 'count')::int,
    (v_resumen ->> 'pending_count')::int, (v_resumen ->> 'pending_amount')::numeric,
    v_resumen, p_notes, p_user_id
  )
  returning id into v_id;

  return v_id;
end
$$;

revoke execute on function animal.lock_cash_day(uuid, date) from public, anon, authenticated;
revoke execute on function animal.cash_day_summary(uuid, uuid, date) from public, anon, authenticated;
revoke execute on function animal.close_cash_day(uuid, uuid, date, uuid, numeric, numeric, numeric, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function animal.lock_cash_day(uuid, date) to service_role;
grant execute on function animal.cash_day_summary(uuid, uuid, date) to service_role;
grant execute on function animal.close_cash_day(uuid, uuid, date, uuid, numeric, numeric, numeric, numeric, numeric, text)
  to service_role;

-- ── DOWN (rollback manual) ───────────────────────────────────
-- drop function if exists animal.close_cash_day(uuid, uuid, date, uuid, numeric, numeric, numeric, numeric, numeric, text);
-- drop function if exists animal.cash_day_summary(uuid, uuid, date);
-- drop trigger if exists visit_payments_cash_check on animal.visit_payments;
-- drop function if exists animal.visit_payments_cash_check();
-- drop function if exists animal.lock_cash_day(uuid, date);
-- drop table if exists animal.cash_closures;
-- drop index if exists animal.visit_payments_caja_idx;
-- alter table animal.visit_payments drop constraint if exists visit_payments_branch_fkey,
--   drop column if exists branch_id, drop column if exists date;
-- (los valores WEBPAY y OTRO del enum no se pueden quitar; reasignar antes:
--  update animal.visit_payments set method = 'TRANSFERENCIA' where method in ('WEBPAY', 'OTRO');)
