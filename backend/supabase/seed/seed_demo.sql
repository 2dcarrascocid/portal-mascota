-- ============================================================
-- Seed: seed_demo.sql
-- Description: Datos de prueba (desarrollo / QA). NO es una migración:
--   no ejecutar en producción.
--   * Organización "Portal Animal Demo" con 3 sucursales (Santiago).
--   * Personal: 1 administradora, 1 recepcionista (rol "Recepcionista",
--     solo sucursal Providencia), 3 veterinarios, 2 peluqueros y
--     1 adiestrador, con especialidades, sucursales y horarios semanales.
--   * Catálogo de servicios asignados a especialidades.
--   * 8 tutores con 12 mascotas y citas para ayer, hoy y mañana (para
--     probar Recepción).
--   Contraseña de todas las cuentas: Demo2026!
--   Emails: admin@ · recepcion@ · m.herrera@ · f.castro@ · i.perez@ ·
--           j.reyes@ · s.morales@ · r.silva@  (todos @demo.portalanimal.cl)
-- Requiere: migraciones 0001 a 0012.
-- Idempotente: ids fijos + "on conflict do nothing" (se puede re-ejecutar;
--   las citas se crean relativas a la fecha del día en America/Santiago).
-- Date: 2026-10-17
-- ============================================================

begin;

-- ── Organización ─────────────────────────────────────────────
insert into animal.organizations (id, name, type, tax_id, address, phone, email, settings)
values (
  'a0000000-0000-4000-8000-000000000001',
  'Portal Animal Demo', 'PRIVATE_COMPANY', '76123456-0',
  'Av. Providencia 1234, Providencia', '+56 2 2345 6789', 'contacto@demo.portalanimal.cl',
  '{"public_signup": true}'
)
on conflict (id) do nothing;

-- ── Sucursales ───────────────────────────────────────────────
insert into animal.branches (id, organization_id, name, address, phone, email, city, region, latitude, longitude)
values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Providencia',
   'Av. Providencia 1234, Providencia', '+56 2 2345 6789', 'providencia@demo.portalanimal.cl',
   'Providencia', 'Región Metropolitana', -33.425800, -70.613600),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Ñuñoa',
   'Av. Irarrázaval 3456, Ñuñoa', '+56 2 2456 7890', 'nunoa@demo.portalanimal.cl',
   'Ñuñoa', 'Región Metropolitana', -33.454400, -70.597100),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Maipú',
   'Av. Pajaritos 2100, Maipú', '+56 2 2567 8901', 'maipu@demo.portalanimal.cl',
   'Maipú', 'Región Metropolitana', -33.510900, -70.757900)
on conflict (id) do nothing;

-- ── Rol de permisos: Recepcionista ───────────────────────────
-- Códigos del catálogo de backend/src/lib/permisos.js.
insert into animal.roles (id, organization_id, name, description, permissions)
values (
  'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
  'Recepcionista', 'Recibe mascotas, agenda citas, registra tutores y cobra las atenciones.',
  array[
    'especialidades.ver', 'servicios.ver', 'agendas.ver', 'sucursales.ver', 'especies.ver',
    'citas.ver', 'citas.crear', 'citas.editar',
    'recepcion.ver', 'recepcion.crear', 'recepcion.editar',
    'tutores.ver', 'tutores.crear', 'tutores.editar'
  ]
)
on conflict (id) do nothing;

-- ── Personal ─────────────────────────────────────────────────
-- password_hash = scrypt de 'Demo2026!' (formato de src/lib/passwords.js).
insert into animal.usuarios (
  id, email, password_hash, first_name, last_name, full_name, rut, phone,
  email_verificado_at, role, role_id, organization_id, activo
)
select u.id::uuid, u.email, 'scrypt$16384$8$1$u4-1VkTXSAKtGDG45ZUt7A$nsUcXRP6zTTQg5GmLi_9qP0QagcbiTUKU7EujsOQBK3uZOWSvlUyRb3qkiuNtdewb-SSDDhap5dAi_utStnDXg',
       u.first_name, u.last_name, u.first_name || ' ' || u.last_name, u.rut, u.phone,
       now(), u.role::animal.user_role, u.role_id::uuid, 'a0000000-0000-4000-8000-000000000001', true
from (values
  ('d0000000-0000-4000-8000-000000000001', 'admin@demo.portalanimal.cl',     'Carolina',  'Fuentes Rojas',  '15234567-4', '+56 9 8111 1111', 'ORG_ADMIN', null),
  ('d0000000-0000-4000-8000-000000000002', 'recepcion@demo.portalanimal.cl', 'Daniela',   'Muñoz Soto',     '16345678-8', '+56 9 8222 2222', 'STAFF', 'c0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000011', 'm.herrera@demo.portalanimal.cl', 'Matías',    'Herrera Lagos',  '17456789-1', '+56 9 8333 1111', 'STAFF', null),
  ('d0000000-0000-4000-8000-000000000012', 'f.castro@demo.portalanimal.cl',  'Fernanda',  'Castro Vidal',   '18567890-3', '+56 9 8333 2222', 'STAFF', null),
  ('d0000000-0000-4000-8000-000000000013', 'i.perez@demo.portalanimal.cl',   'Ignacio',   'Pérez Mella',    '13678901-5', '+56 9 8333 3333', 'STAFF', null),
  ('d0000000-0000-4000-8000-000000000021', 'j.reyes@demo.portalanimal.cl',   'Javiera',   'Reyes Tapia',    '14789012-5', '+56 9 8444 1111', 'STAFF', null),
  ('d0000000-0000-4000-8000-000000000022', 's.morales@demo.portalanimal.cl', 'Sebastián', 'Morales Díaz',   '19890123-7', '+56 9 8444 2222', 'STAFF', null),
  ('d0000000-0000-4000-8000-000000000031', 'r.silva@demo.portalanimal.cl',   'Rodrigo',   'Silva Navarro',  '12901234-K', '+56 9 8555 1111', 'STAFF', null)
) as u (id, email, first_name, last_name, rut, phone, role, role_id)
on conflict (id) do nothing;

-- ── Especialidades ───────────────────────────────────────────
insert into animal.specialties (id, organization_id, name, description)
values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Medicina general', 'Consultas, vacunas y controles.'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Cirugía', 'Procedimientos quirúrgicos y controles post operatorios.'),
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Peluquería canina', 'Baño, corte y estética para perros.'),
  ('e0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'Peluquería felina', 'Baño y estética para gatos.'),
  ('e0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'Adiestramiento', 'Obediencia básica y avanzada.'),
  ('e0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'Etología', 'Evaluación y manejo de conducta.')
on conflict (id) do nothing;

-- Especialidades del personal (la recepcionista y la admin no atienden).
insert into animal.staff_specialties (staff_id, specialty_id, organization_id)
select s::uuid, e::uuid, 'a0000000-0000-4000-8000-000000000001'
from (values
  ('d0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000013', 'e0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000013', 'e0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000003'),
  ('d0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000004'),
  ('d0000000-0000-4000-8000-000000000022', 'e0000000-0000-4000-8000-000000000003'),
  ('d0000000-0000-4000-8000-000000000031', 'e0000000-0000-4000-8000-000000000005'),
  ('d0000000-0000-4000-8000-000000000031', 'e0000000-0000-4000-8000-000000000006')
) as x (s, e)
on conflict do nothing;

-- ── Personal por sucursal ────────────────────────────────────
-- b..01 Providencia · b..02 Ñuñoa · b..03 Maipú
insert into animal.staff_branches (staff_id, branch_id, organization_id)
select s::uuid, b::uuid, 'a0000000-0000-4000-8000-000000000001'
from (values
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001'),  -- recepcionista: solo Providencia
  ('d0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000003'),
  ('d0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000003'),
  ('d0000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000031', 'b0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000031', 'b0000000-0000-4000-8000-000000000001')
) as x (s, b)
on conflict do nothing;

-- ── Horarios semanales (0 = domingo) ─────────────────────────
-- Quien atiende en dos sucursales lo hace en días distintos.
-- Veterinarios: turnos de 30 min; peluquería y adiestramiento: 60 min.
insert into animal.schedules (organization_id, staff_id, branch_id, day_of_week, start_time, end_time, slot_duration_minutes, valid_from)
select 'a0000000-0000-4000-8000-000000000001', h.staff::uuid, h.branch::uuid, dia, h.desde::time, h.hasta::time, h.turno,
       date_trunc('month', current_date)::date
from (values
  -- Matías Herrera (vet): Providencia lun/mié/vie, Ñuñoa mar/jue
  ('d0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000001', array[1, 3, 5], '09:00', '13:00', 30),
  ('d0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000001', array[1, 3, 5], '14:00', '18:00', 30),
  ('d0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000002', array[2, 4], '09:00', '13:00', 30),
  ('d0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000002', array[2, 4], '14:00', '18:00', 30),
  -- Fernanda Castro (vet): Ñuñoa lun a vie + sábado mañana
  ('d0000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000002', array[1, 2, 3, 4, 5], '09:00', '17:00', 30),
  ('d0000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000002', array[6], '10:00', '14:00', 30),
  -- Ignacio Pérez (vet): Maipú lun a jue, Providencia vie/sáb
  ('d0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000003', array[1, 2, 3, 4], '10:00', '19:00', 30),
  ('d0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000001', array[5], '10:00', '19:00', 30),
  ('d0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000001', array[6], '10:00', '14:00', 30),
  -- Javiera Reyes (peluquera): Providencia lun a sáb
  ('d0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000001', array[1, 2, 3, 4, 5, 6], '09:00', '17:00', 60),
  -- Sebastián Morales (peluquero): Maipú lun/mié/vie, Ñuñoa mar/jue/sáb
  ('d0000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000003', array[1, 3, 5], '09:00', '17:00', 60),
  ('d0000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000002', array[2, 4, 6], '09:00', '17:00', 60),
  -- Rodrigo Silva (adiestrador): Ñuñoa lun/mié, Providencia mar/jue/sáb
  ('d0000000-0000-4000-8000-000000000031', 'b0000000-0000-4000-8000-000000000002', array[1, 3], '15:00', '20:00', 60),
  ('d0000000-0000-4000-8000-000000000031', 'b0000000-0000-4000-8000-000000000001', array[2, 4], '15:00', '20:00', 60),
  ('d0000000-0000-4000-8000-000000000031', 'b0000000-0000-4000-8000-000000000001', array[6], '10:00', '14:00', 60)
) as h (staff, branch, dias, desde, hasta, turno)
cross join lateral unnest(h.dias) as dia
-- Re-ejecutable: no duplica bloques ya cargados.
where not exists (
  select 1 from animal.schedules s
   where s.staff_id = h.staff::uuid and s.branch_id = h.branch::uuid
     and s.day_of_week = dia and s.start_time = h.desde::time
);

-- ── Catálogo de servicios ────────────────────────────────────
insert into animal.services_catalog (id, organization_id, category, name, description, price, duration_minutes)
values
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'VET', 'Consulta general', 'Evaluación clínica completa.', 25000, 30),
  ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'VET', 'Vacunación', 'Vacuna + certificado.', 18000, 30),
  ('f0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'VET', 'Desparasitación', 'Interna y externa.', 12000, 30),
  ('f0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'VET', 'Control post operatorio', null, 15000, 30),
  ('f0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'VET', 'Esterilización', 'Incluye anestesia y control.', 120000, 120),
  ('f0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 'GROOMING', 'Baño y corte perro pequeño', 'Hasta 10 kg.', 22000, 60),
  ('f0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', 'GROOMING', 'Baño y corte perro grande', 'Más de 10 kg.', 35000, 60),
  ('f0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001', 'GROOMING', 'Baño gato', null, 25000, 60),
  ('f0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000001', 'GROOMING', 'Corte de uñas', null, 6000, 15),
  ('f0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000001', 'TRAINING', 'Sesión de adiestramiento', 'Obediencia básica.', 30000, 60),
  ('f0000000-0000-4000-8000-000000000022', 'a0000000-0000-4000-8000-000000000001', 'TRAINING', 'Evaluación conductual', null, 40000, 60)
on conflict (id) do nothing;

insert into animal.specialty_services (specialty_id, service_id, organization_id)
select e::uuid, s::uuid, 'a0000000-0000-4000-8000-000000000001'
from (values
  ('e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000003'),
  ('e0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000004'),
  ('e0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000005'),
  ('e0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000011'),
  ('e0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000012'),
  ('e0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000014'),
  ('e0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000013'),
  ('e0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000014'),
  ('e0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000021'),
  ('e0000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000022')
) as x (e, s)
on conflict do nothing;

-- ── Tutores ──────────────────────────────────────────────────
insert into animal.clients (id, organization_id, national_id, first_name, last_name, phone, email, address)
select c.id::uuid, 'a0000000-0000-4000-8000-000000000001', c.rut, c.nombre, c.apellido, c.fono, c.email, c.direccion
from (values
  ('10000000-0000-4000-8000-000000000001', '20123456-5', 'Valentina', 'González Pino',   '+56 9 9123 4501', 'valentina.gonzalez@correo.cl', 'Los Leones 450, Providencia'),
  ('10000000-0000-4000-8000-000000000002', '11234567-1', 'Jorge',     'Ramírez Cortés',  '+56 9 9123 4502', 'jorge.ramirez@correo.cl',      'Pedro de Valdivia 1200, Providencia'),
  ('10000000-0000-4000-8000-000000000003', '10345678-9', 'Camila',    'Sepúlveda Araya', '+56 9 9123 4503', 'camila.sepulveda@correo.cl',   'Suecia 0155, Ñuñoa'),
  ('10000000-0000-4000-8000-000000000004', '21456789-K', 'Benjamín',  'Torres Vega',     '+56 9 9123 4504', null,                           'Grecia 2300, Ñuñoa'),
  ('10000000-0000-4000-8000-000000000005', '9567890-4',  'Patricia',  'Contreras Lillo', '+56 2 2789 4505', 'patricia.contreras@correo.cl', 'Av. Los Pajaritos 3050, Maipú'),
  ('10000000-0000-4000-8000-000000000006', '16789012-1', 'Felipe',    'Espinoza Bravo',  '+56 9 9123 4506', 'felipe.espinoza@correo.cl',    '5 de Abril 870, Maipú'),
  ('10000000-0000-4000-8000-000000000007', '17890123-0', 'Antonia',   'Rojas Figueroa',  '+56 9 9123 4507', 'antonia.rojas@correo.cl',      'Manuel Montt 990, Providencia'),
  ('10000000-0000-4000-8000-000000000008', '18901234-9', 'Diego',     'Vargas Molina',   '+56 9 9123 4508', null,                           'Irarrázaval 4100, Ñuñoa')
) as c (id, rut, nombre, apellido, fono, email, direccion)
on conflict (id) do nothing;

-- ── Mascotas (especies y razas del catálogo base) ────────────
insert into animal.pets (id, client_id, organization_id, name, species_id, breed_id, birth_date, weight, microchip_number, notes)
select m.id::uuid, m.tutor::uuid, 'a0000000-0000-4000-8000-000000000001', m.nombre, e.id, r.id,
       m.nacimiento::date, m.peso, m.chip, m.notas
from (values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Rocky',   'Perro', 'Labrador Retriever', '2019-03-12', 31.5, '900123000000001', 'Alérgico al pollo.'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Michi',   'Gato',  'Siamés',             '2021-07-01', 4.2,  null,              null),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Luna',    'Perro', 'Poodle',             '2020-11-20', 6.8,  '900123000000003', null),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'Simba',   'Gato',  'Maine Coon',         '2018-05-05', 7.9,  null,              'Se estresa en el transporte.'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003', 'Nala',    'Gato',  'Mestizo',            '2022-02-14', 3.6,  null,              null),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000004', 'Thor',    'Perro', 'Pastor Alemán',      '2017-09-30', 38.0, '900123000000006', 'Displasia de cadera en control.'),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000005', 'Canela',  'Perro', 'Mestizo',            '2016-01-10', 14.3, null,              null),
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000005', 'Pelusa',  'Perro', 'Shih Tzu',           '2023-04-22', 5.1,  null,              null),
  ('20000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000006', 'Max',     'Perro', 'Border Collie',      '2024-06-15', 17.0, '900123000000009', 'Cachorro muy activo.'),
  ('20000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000007', 'Kira',    'Perro', 'Bulldog Francés',    '2022-08-08', 11.2, '900123000000010', 'Braquicéfalo: cuidado con el calor.'),
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000007', 'Oliver',  'Gato',  'Persa',              '2020-12-03', 5.4,  null,              null),
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000008', 'Toby',    'Perro', 'Beagle',             '2021-10-17', 12.6, null,              null)
) as m (id, tutor, nombre, especie, raza, nacimiento, peso, chip, notas)
join animal.species e on e.organization_id is null and e.name = m.especie
left join animal.breeds r on r.species_id = e.id and r.organization_id is null and r.name = m.raza
on conflict (id) do nothing;

-- ── Citas: ayer (historia), hoy (para Recepción) y mañana ────
-- Fechas relativas al día local de Chile. Horas alineadas a los turnos.
with dia as (select (now() at time zone 'America/Santiago')::date as hoy)
insert into animal.appointments (
  id, organization_id, branch_id, staff_id, date, start_time, end_time, service_id, specialty_id,
  client_id, pet_id, contact_name, contact_phone, contact_email, notes, status, created_by
)
select x.id::uuid, 'a0000000-0000-4000-8000-000000000001', x.branch::uuid, x.staff::uuid,
       dia.hoy + x.offset_dias, x.inicio::time, x.inicio::time + make_interval(mins => x.minutos),
       x.servicio::uuid, x.especialidad::uuid, c.id, x.mascota::uuid,
       coalesce(x.contacto, c.first_name || ' ' || c.last_name), coalesce(x.fono, c.phone), c.email,
       x.notas, x.estado::animal.appointment_status, 'd0000000-0000-4000-8000-000000000002'
from dia, (values
  -- Ayer: atendidas / no asistió (para revisar la vista de consulta)
  ('30000000-0000-4000-8000-000000000001', -1, 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000021', '10:00', 60, 'f0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', null, null, null, 'ATENDIDA'),
  ('30000000-0000-4000-8000-000000000002', -1, 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000012', '11:00', 30, 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000006', null, null, null, 'NO_ASISTIO'),

  -- Hoy · Providencia (las que ve la recepcionista)
  ('30000000-0000-4000-8000-000000000011', 0, 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000011', '09:30', 30, 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', null, null, 'Cojea de la pata trasera.', 'CONFIRMADA'),
  ('30000000-0000-4000-8000-000000000012', 0, 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000011', '10:00', 30, 'f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', null, null, 'Vacuna triple felina.', 'RESERVADA'),
  ('30000000-0000-4000-8000-000000000013', 0, 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000021', '11:00', 60, 'f0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', null, null, null, 'RESERVADA'),
  ('30000000-0000-4000-8000-000000000014', 0, 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000021', '12:00', 60, 'f0000000-0000-4000-8000-000000000013', 'e0000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000011', null, null, null, 'CONFIRMADA'),
  ('30000000-0000-4000-8000-000000000015', 0, 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000011', '15:00', 30, 'f0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000010', null, null, 'Control 10 días post esterilización.', 'RESERVADA'),
  ('30000000-0000-4000-8000-000000000016', 0, 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000031', '16:00', 60, 'f0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000009', null, null, 'Primera sesión.', 'RESERVADA'),
  -- Hoy · Providencia, sin ficha (solo contacto)
  ('30000000-0000-4000-8000-000000000017', 0, 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000011', '16:30', 30, 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', null, null, 'Paula Cifuentes', '+56 9 7654 3210', 'Perrita mestiza "Mora", vómitos desde ayer.', 'RESERVADA'),

  -- Hoy · Ñuñoa
  ('30000000-0000-4000-8000-000000000021', 0, 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000012', '09:00', 30, 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004', null, null, null, 'CONFIRMADA'),
  ('30000000-0000-4000-8000-000000000022', 0, 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000012', '09:30', 30, 'f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000005', null, null, null, 'RESERVADA'),
  ('30000000-0000-4000-8000-000000000023', 0, 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000022', '10:00', 60, 'f0000000-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000012', null, null, null, 'RESERVADA'),
  ('30000000-0000-4000-8000-000000000024', 0, 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000012', '11:30', 30, 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000006', null, null, 'Control de cadera.', 'RESERVADA'),

  -- Hoy · Maipú
  ('30000000-0000-4000-8000-000000000031', 0, 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000013', '10:30', 30, 'f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000007', null, null, null, 'CONFIRMADA'),
  ('30000000-0000-4000-8000-000000000032', 0, 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000022', '11:00', 60, 'f0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000008', null, null, null, 'RESERVADA'),

  -- Mañana (no se pueden recibir hoy)
  ('30000000-0000-4000-8000-000000000041', 1, 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000021', '09:00', 60, 'f0000000-0000-4000-8000-000000000014', 'e0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', null, null, null, 'RESERVADA'),
  ('30000000-0000-4000-8000-000000000042', 1, 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000012', '10:00', 30, 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000012', null, null, null, 'RESERVADA')
) as x (id, offset_dias, branch, staff, inicio, minutos, servicio, especialidad, tutor, mascota, contacto, fono, notas, estado)
left join animal.clients c on c.id = x.tutor::uuid
on conflict do nothing;

commit;

-- ── Limpieza (manual) ────────────────────────────────────────
-- Borra todo lo del demo. Las citas se borran antes que el personal
-- (appointments.staff_id no tiene cascade).
-- begin;
-- delete from animal.appointments where organization_id = 'a0000000-0000-4000-8000-000000000001';
-- delete from animal.usuarios where organization_id = 'a0000000-0000-4000-8000-000000000001';
-- delete from animal.organizations where id = 'a0000000-0000-4000-8000-000000000001';
-- commit;
