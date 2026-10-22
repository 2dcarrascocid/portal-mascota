-- ============================================================
-- Seed: citas_prueba_contactabilidad.sql
-- Description: Citas RESERVADA de hoy y mañana en la sucursal Maipú para
--   probar la integración de contactabilidad sin escribirle a tutores
--   reales: el tutor y el contacto de las citas son los del probador.
--   NO es una migración: no ejecutar en producción.
--   * Tutor "Prueba Contactabilidad" + mascota "Firulais".
--   * Ignacio Pérez (vet, Maipú lun–jue, turnos 30 min): hoy y mañana.
--   * Sebastián Morales (peluquero, Maipú lun/mié/vie, turnos 60 min):
--     hoy y mañana, solo si ese día atiende en Maipú.
--   Turnos que ya pasaron, días sin horario o turnos ocupados se omiten.
-- Requiere: seed_demo.sql.
-- Idempotente: ids fijos + "on conflict do nothing".
-- Antes de ejecutar: poner tu teléfono en v_telefono (formato +569XXXXXXXX)
--   o dejarlo en null para probar solo por correo.
-- Date: 2026-10-21
-- ============================================================

begin;

create temporary table prueba_params on commit drop as
select '2dcarrascocid@gmail.com'::text as v_email,
       '+56953909602'::text            as v_telefono,   -- null = probar solo por correo
       (now() at time zone 'America/Santiago')::date as hoy,
       (now() at time zone 'America/Santiago')::time as ahora;

-- ── Tutor y mascota de prueba ────────────────────────────────
insert into animal.clients (id, organization_id, first_name, last_name, phone, email, address)
select '10000000-0000-4000-8000-000000000099', 'a0000000-0000-4000-8000-000000000001',
       'Prueba', 'Contactabilidad', p.v_telefono, p.v_email, 'Av. Pajaritos 2100, Maipú'
from prueba_params p
on conflict (id) do update set phone = excluded.phone, email = excluded.email;

insert into animal.pets (id, client_id, organization_id, name, species_id, notes)
select '20000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000099',
       'a0000000-0000-4000-8000-000000000001', 'Firulais', e.id, 'Mascota de prueba (contactabilidad).'
from animal.species e
where e.organization_id is null and e.name = 'Perro'
on conflict (id) do nothing;

-- ── Citas ────────────────────────────────────────────────────
-- Solo se insertan si el profesional tiene horario ese día en Maipú, el
-- turno aún no pasa y está libre (índice appointments_turno_unico).
insert into animal.appointments (
  id, organization_id, branch_id, staff_id, date, start_time, end_time, service_id, specialty_id,
  client_id, pet_id, contact_name, contact_phone, contact_email, notes, status, created_by
)
select x.id::uuid, 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', x.staff::uuid,
       p.hoy + x.offset_dias, x.inicio::time, x.inicio::time + make_interval(mins => x.minutos),
       x.servicio::uuid, x.especialidad::uuid,
       '10000000-0000-4000-8000-000000000099', '20000000-0000-4000-8000-000000000099',
       'Prueba Contactabilidad', p.v_telefono, p.v_email, 'Cita de prueba de contactabilidad.', 'RESERVADA',
       'd0000000-0000-4000-8000-000000000001'
from prueba_params p, (values
  -- Ignacio Pérez · vet · 30 min
  ('30000000-0000-4000-8000-000000000901', 0, 'd0000000-0000-4000-8000-000000000013', '17:00', 30, 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000902', 0, 'd0000000-0000-4000-8000-000000000013', '17:30', 30, 'f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000903', 0, 'd0000000-0000-4000-8000-000000000013', '18:00', 30, 'f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000904', 0, 'd0000000-0000-4000-8000-000000000013', '18:30', 30, 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000911', 1, 'd0000000-0000-4000-8000-000000000013', '10:00', 30, 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000912', 1, 'd0000000-0000-4000-8000-000000000013', '11:00', 30, 'f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000913', 1, 'd0000000-0000-4000-8000-000000000013', '15:00', 30, 'f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000914', 1, 'd0000000-0000-4000-8000-000000000013', '17:30', 30, 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001'),
  -- Sebastián Morales · peluquería · 60 min
  ('30000000-0000-4000-8000-000000000921', 0, 'd0000000-0000-4000-8000-000000000022', '15:00', 60, 'f0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000003'),
  ('30000000-0000-4000-8000-000000000922', 0, 'd0000000-0000-4000-8000-000000000022', '16:00', 60, 'f0000000-0000-4000-8000-000000000014', 'e0000000-0000-4000-8000-000000000003'),
  ('30000000-0000-4000-8000-000000000923', 1, 'd0000000-0000-4000-8000-000000000022', '10:00', 60, 'f0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000003')
) as x (id, offset_dias, staff, inicio, minutos, servicio, especialidad)
where (x.offset_dias > 0 or x.inicio::time > p.ahora)
  and exists (
    select 1 from animal.schedules s
     where s.staff_id = x.staff::uuid
       and s.branch_id = 'b0000000-0000-4000-8000-000000000003'
       and s.is_active
       and s.day_of_week = extract(dow from p.hoy + x.offset_dias)
       and x.inicio::time >= s.start_time
       and x.inicio::time + make_interval(mins => x.minutos) <= s.end_time
  )
on conflict do nothing;

commit;

-- Resumen de lo que quedó agendado (el SQL Editor muestra este resultado)
select a.date as fecha, to_char(a.start_time, 'HH24:MI') as hora, u.first_name || ' ' || u.last_name as profesional,
       sc.name as servicio, a.status, a.contact_email, a.contact_phone
from animal.appointments a
join animal.usuarios u on u.id = a.staff_id
left join animal.services_catalog sc on sc.id = a.service_id
where a.client_id = '10000000-0000-4000-8000-000000000099'
order by a.date, a.start_time;

-- ── Limpieza (manual) ────────────────────────────────────────
-- delete from animal.appointments where client_id = '10000000-0000-4000-8000-000000000099';
-- delete from animal.pets where id = '20000000-0000-4000-8000-000000000099';
-- delete from animal.clients where id = '10000000-0000-4000-8000-000000000099';
