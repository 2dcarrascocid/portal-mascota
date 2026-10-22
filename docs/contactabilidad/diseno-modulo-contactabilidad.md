# Módulo de Contactabilidad y Atención Presencial — Diseño

> Portal Animal · Rama base: `feature/configuracion-agenda-recepcion` · Fecha: 2026-10-19
>
> **Fuentes:** esquema real del sistema (migraciones `0001`–`0014`) y dos
> bases de referencia de contactabilidad en salud pública, usadas como
> **referencia de requisitos** (no como contrato):
>
> - **[CHG]** SOPI N° 98/2026 DAS Chiguayante — servicio de call center.
> - **[SFE]** Bases técnicas Contactabilidad y Gestión de Filas, Red APS San Fernando.
>
> La trazabilidad requisito → diseño está en la **§7**. En los parámetros
> (§4), **[CHG]/[SFE]** marca un valor tomado de las referencias y **⚠** uno
> que ninguna de las dos define (valor típico de mercado, a validar en el
> piloto).

---

## 0. Punto de partida (lo que ya existe y se reutiliza)

| Pieza existente | Dónde | Cómo la usa el módulo |
|---|---|---|
| Estados de cita `RESERVADA → CONFIRMADA → LLEGO → ATENDIDA / NO_ASISTIO / CANCELADA` | `0008_citas.sql`, `0011` | La confirmación pasa `RESERVADA → CONFIRMADA`. No se crean estados nuevos. |
| Índice `appointments_turno_unico` (`where status <> 'CANCELADA'`) | `0008` | **Liberar un cupo = pasar la cita a `CANCELADA`.** El turno queda libre solo, sin tocar la agenda. |
| `release_expired_bookings()` llamada antes de calcular turnos | `0014`, `citas.js:26` | Mismo patrón para `release_unconfirmed_appointments()`: liberación perezosa + un job programado. |
| `GET /citas/disponibles` | `citas.js:114` | Endpoint de agenda disponible: se reutiliza tal cual para el panel; se expone una variante por token para reprogramar desde WhatsApp. |
| `clients.phone_digits`, `appointments.contact_phone_digits` | `0011` | Búsqueda por teléfono en el tótem y cruce del `from` del webhook con la cita. |
| `clients.national_id` (RUT canónico) + `frontend/src/lib/rut.js` | `0004`, `0014` | Check-in por RUT. |
| Creación de atención (`POST /atenciones`) que deja la cita en `LLEGO` | `recepcion.js` | El check-in del tótem llama la **misma lógica** (se extrae a una función compartida). |
| `close_visit()` | `0011` | Disparador de la encuesta post-atención. |
| SMTP (`lib/mailer.js`, `lib/correos.js`) | backend | **Canal de recordatorio disponible hoy**, sin aprobación de Meta. |
| Roles con permisos `modulo.accion` | `lib/permisos.js` | Nuevos módulos `contactabilidad`, `contactos`, `fila`. |
| Lambda única + router por tabla | `handler.js`, `serverless.yml` | Se agregan rutas; el despachador va en una **segunda función** con evento `schedule`. |

Restricciones de la plataforma que condicionan el diseño:

- **Lambda sin estado ni WebSockets** → el envío es un *outbox* en BD procesado por un job cada 5 min; las pantallas de sala hacen *polling* corto.
- **Todo el esquema `animal` es solo `service_role`** → los tótems y pantallas **no** usan Supabase directo; pasan por el backend con un token de dispositivo.
- **Zona horaria `America/Santiago`** (`ZONA_HORARIA`) → la cita guarda `date` + `start_time` locales; el job convierte a `timestamptz` para programar envíos.

---

## 1. Reglas de negocio y casos de uso

### 1.1 Confirmación automática de citas

**Línea de tiempo de una cita (valores por defecto, configurables en §3):**

```
creada ─── T-48h ─────────── T-24h ──────── T-12h ───────────── T (cita)
           Recordatorio 1     Recordatorio 2  PLAZO LÍMITE
           (plantilla con     (si no hubo     ├─ sin respuesta + entregado → LIBERAR
            botones)           respuesta)     └─ sin respuesta + NO entregado → ESCALAR a agente
```

**Reglas:**

| # | Regla | Detalle |
|---|---|---|
| R1 | Qué citas entran | `status = 'RESERVADA'`, con teléfono (ficha o `contact_phone`), tutor con consentimiento WhatsApp vigente. Sin consentimiento → canal email (si hay) o cola del agente. |
| R2 | Citas creadas cerca de la hora | Si se crea con menos anticipación que el recordatorio 1, se envía **un único** mensaje inmediato. Si se crea con menos de `plazo_limite` de anticipación, **nace exenta de liberación** (no tiene sentido cancelarla por no confirmar). |
| R3 | Respuesta "Confirmar" | `RESERVADA → CONFIRMADA`, guarda `confirmed_at`, `confirmation_channel`. Se cancelan los recordatorios pendientes. |
| R4 | Respuesta "Cancelar" | `→ CANCELADA`, `cancel_reason = 'Cancelada por el tutor vía WhatsApp'`. El cupo queda libre al instante (índice parcial). Se responde con link para reagendar. |
| R5 | Respuesta "Reagendar" | No cancela: crea un contacto para el agente (Fase 2) o envía link con turnos (`/c/:token/turnos`). La cita original se mantiene hasta que se tome otro turno. |
| R6 | Sin respuesta al plazo límite | **Liberación automática solo si el mensaje quedó `delivered` o `read`.** Si falló o quedó solo `sent`, *no* se libera: se escala a la cola del agente. Evita cancelar citas porque Meta no entregó. |
| R7 | Citas pagadas en línea | `payment_status = 'PAGADO'` **nunca** se liberan automáticamente (habría que devolver el pago). Se escalan al agente. |
| R8 | Citas ya confirmadas, `LLEGO`, `ATENDIDA` | Nunca se tocan. Toda transición se hace con `where status = 'RESERVADA'` (condición en el `update`), así una respuesta tardía no pisa un estado posterior. |
| R9 | Horario de envío | No enviar fuera de `horario_envio` (p. ej. 09:00–20:00). Un envío que cae fuera se corre al inicio de la siguiente ventana; si eso lo deja después del plazo límite, se adelanta a la ventana anterior. |
| R10 | Respuesta tardía (después de liberar) | "Confirmar" sobre una cita ya `CANCELADA`: se responde "Tu hora fue liberada, ¿quieres reagendar?" + link. **No** se reactiva (el turno pudo tomarse). |
| R11 | Texto libre | Se intenta interpretar (`si`, `confirmo`, `1` → confirmar; `no`, `cancelar`, `2` → cancelar). Lo que no se entiende va a la bandeja del agente. |
| R12 | Lista de espera (opcional) | Al liberarse un cupo se puede ofrecer a tutores en lista de espera del mismo servicio/día (primero que confirma, gana — la reserva usa el mismo índice único, así que no hay doble reserva). |
| R13 | Inasistencia | Tras `tolerancia_atraso_min` sin check-in, la cita puede pasar a `NO_ASISTIO` (manual o automático según parámetro). Alimenta el indicador de inasistencia por tutor. |

**Por qué WhatsApp primero y voz después:** en Chile la penetración de WhatsApp hace que cubra la gran mayoría de los casos a costo mucho menor que un voicebot/IVR. Ambas referencias exigen voz ([SFE] IVR/Voicebot; [CHG] call center con agentes), así que la voz está en el diseño, pero en Fase 2 y para el residuo: sin WhatsApp, mensaje no entregado, citas pagadas o de alto valor (cirugías), y llamadas **entrantes** de tutores.

**Contacto efectivo [SFE]:** las bases de San Fernando pagan por "contacto efectivamente logrado e interactuado". Se adopta la misma definición como métrica del módulo (y como posible unidad de cobro del SaaS): un contacto es efectivo cuando el tutor **responde** (confirma, cancela, reagenda, contesta la encuesta) o **contesta** una llamada. Un mensaje entregado sin respuesta **no** cuenta.

### 1.2 Tótem, ticket y sala de espera

**Flujo de check-in:**

```
Tutor llega ─► Tótem: "Ingresa tu RUT o teléfono"
                 │
                 ├─ 1 cita hoy en esta sucursal ──► "Bobi · Peluquería 10:30 ¿Eres tú?" ─► [Sí]
                 ├─ varias citas hoy ─────────────► elige la mascota/cita
                 └─ ninguna ──────────────────────► "Sin cita: ¿Veterinaria / Peluquería / Urgencia?"
                                                    (ticket espontáneo, sin atención creada)
                 ▼
     Con cita: se crea la atención (visits) → cita pasa a LLEGO → se emite ticket
                 ▼
     Ticket impreso / en pantalla:  P-014 · Bobi · Peluquería · ~2 en espera
                 ▼
     Recepción / profesional pulsa "Llamar siguiente" (o un ticket puntual) en su box
                 ▼
     Pantalla de sala:  ATENCIÓN PELUQUERÍA — Bobi → Box 2   (+ aviso sonoro / voz)
```

**Reglas:**

| # | Regla | Detalle |
|---|---|---|
| T1 | Ventana de check-in | Desde `checkin_antes_min` antes de la hora (p. ej. 60) hasta `tolerancia_atraso_min` después. Fuera de ella el tótem deriva a recepción. |
| T2 | Privacidad en el tótem | Nunca mostrar RUT completo, apellido ni teléfono: "Bobi — tutor D. C." Solo citas **de hoy y de esa sucursal**. Respuesta idéntica exista o no el RUT cuando no hay cita (no revela si alguien es cliente). |
| T3 | Privacidad en la pantalla | Solo nombre de la mascota + área + box. Nunca el nombre del tutor. |
| T4 | Numeración | Prefijo por área (`V` veterinaria, `P` peluquería, `U` urgencia, `A` adiestramiento) + correlativo **por sucursal y día**, generado con un contador atómico en BD. |
| T5 | Urgencia | El tótem permite *solicitar* urgencia, pero entra como `PRIORIDAD = URGENCIA_SOLICITADA` y genera alerta en recepción; el **triage lo confirma el personal** (si no, todos marcarían urgencia). Confirmada → va primero en veterinaria. |
| T6 | Preferente | [SFE] exige aplicar la Ley 21.168 de Atención Preferente. Esa ley obliga a prestadores de salud humana, no a veterinarias, pero se **adoptan sus criterios como política por defecto** (personas mayores de 60 años y personas con discapacidad, más los que la organización agregue). Se declara en el tótem o se marca en la ficha del tutor (`clients.preferential`); configurable por organización. |
| T7 | Orden de llamado | 1) `URGENCIA` confirmada; 2) citas cuya hora ya llegó, por hora de cita; 3) preferentes; 4) espontáneos por orden de llegada. **Anti-inanición:** cada `ratio_preferente` llamados se intercala un normal, y cualquier ticket que supere `espera_max_min` sube al tope y alerta. |
| T8 | Re-llamado y ausente | `rellamados_max` (p. ej. 3) re-llamados; después pasa a `AUSENTE` y vuelve a la fila solo si recepción lo reactiva. |
| T9 | Fila por área | Cada box atiende una o más áreas (`service_points.categories`); "Llamar siguiente" toma el primero de la fila de sus áreas, respetando el profesional de la cita si lo hay. |
| T10 | Espontáneo sin ficha | El ticket se emite sin crear atención; recepción completa los datos y crea la atención al llamarlo (reutiliza `POST /atenciones` existente). |
| T11 | Derivación a módulos [SFE] | Un ticket puede **derivarse** de un box a otro (p. ej. peluquería → veterinaria si el peluquero detecta una lesión, o recepción → box de pago) sin perder su posición ni su historial (`queue_ticket_events`). |
| T12 | Operación sin conexión [SFE] | Si el tótem pierde internet sigue emitiendo tickets: usa un **bloque de números reservado** por adelantado para ese dispositivo (sin choques con el servidor) y encola los check-ins localmente. Al volver la conexión los sincroniza; los conflictos (cita ya recibida en recepción) quedan para revisión. Sin conexión **no** busca por RUT (no se guardan datos personales en el equipo): solo emite ticket por área y recepción completa. |
| T13 | Ticket impreso [SFE] | Impresora térmica de autocorte (80 mm). El ticket lleva código, área, mascota, hora y un QR para seguir la fila desde el celular; nunca RUT ni nombre del tutor. |

### 1.3 Contingencias y campañas [SFE][CHG]

| # | Regla | Detalle |
|---|---|---|
| C1 | Notificación de contingencia | Al crear un `BLOQUEO` (`schedule_exceptions`) que afecta citas ya tomadas (profesional con licencia, sucursal cerrada, corte de luz), el sistema **lista las citas afectadas** y ofrece notificarlas con plantilla `contingencia_cita` + link para reagendar. Las citas no se cancelan solas: el usuario elige reagendar en bloque o cancelar. |
| C2 | Mensajería multigrupo [CHG] | Campañas a un **segmento** (p. ej. mascotas con vacuna antirrábica por vencer, perros sin desparasitación en 90 días, tutores de una sucursal). Es la adaptación de los "programas de salud" de las bases a **planes preventivos** veterinarios. Solo a tutores con consentimiento, con tope diario y horario de envío. |
| C3 | Canal de respaldo [SFE] | Si WhatsApp falla o el tutor no tiene WhatsApp: SMS → email → llamada (voicebot o agente), según `canales_orden`. |
| C4 | RUT enmascarado [SFE] | Toda plantilla que identifique al tutor usa el RUT enmascarado (`12.***.***-5`), nunca completo. |

---

## 2. Modelo de datos (migraciones propuestas)

Siguen las convenciones del repo: esquema `animal`, `organization_id` en todo, FK compuestas `(id, organization_id)`, RLS activado y acceso solo `service_role`, bloque `DOWN` comentado.

### `0015_contactabilidad.sql`

```sql
-- Parámetros por organización (una fila) con override opcional por sucursal.
create table animal.contact_settings (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references animal.organizations (id) on delete cascade,
  branch_id                 uuid,                      -- null = valor de la organización
  settings                  jsonb not null default '{}', -- ver §3; validado por el backend
  updated_by                uuid references animal.usuarios (id) on delete set null,
  updated_at                timestamptz not null default now(),
  unique nulls not distinct (organization_id, branch_id),
  foreign key (branch_id, organization_id) references animal.branches (id, organization_id) on delete cascade
);

-- Consentimiento (requisito de Meta y de la ley de datos personales).
alter table animal.clients
  add column if not exists whatsapp_opt_in     boolean not null default false,
  add column if not exists whatsapp_opt_in_at  timestamptz,
  add column if not exists whatsapp_opt_out_at timestamptz,
  add column if not exists preferential        boolean not null default false;

-- Trazabilidad de la confirmación en la cita.
alter table animal.appointments
  add column if not exists confirmed_at          timestamptz,
  add column if not exists confirmation_channel  text check (confirmation_channel in ('WHATSAPP','EMAIL','LLAMADA','PRESENCIAL','PORTAL','MANUAL')),
  add column if not exists confirm_deadline      timestamptz,   -- calculado al crear/mover la cita
  add column if not exists auto_release_exempt   boolean not null default false;

create type animal.contact_channel as enum ('WHATSAPP', 'EMAIL', 'SMS', 'VOZ', 'WEBCHAT');
create type animal.contact_kind    as enum ('RECORDATORIO', 'CONFIRMACION_RESP', 'LIBERACION', 'ENCUESTA', 'LISTA_ESPERA', 'CONTINGENCIA', 'CAMPANA');
create type animal.outbox_status   as enum ('PENDIENTE', 'ENVIANDO', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'FALLIDO', 'CANCELADO');

-- Outbox: cada mensaje/llamada programado. El job los toma con FOR UPDATE SKIP LOCKED.
create table animal.contact_outbox (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references animal.organizations (id) on delete cascade,
  appointment_id    uuid references animal.appointments (id) on delete cascade,
  visit_id          uuid references animal.visits (id) on delete cascade,
  channel           animal.contact_channel not null,
  kind              animal.contact_kind not null,
  sequence          smallint not null default 1,          -- recordatorio 1, 2...
  to_address        text not null,                         -- E.164 o email
  template          text not null,
  variables         jsonb not null default '{}',
  scheduled_at      timestamptz not null,
  attempts          smallint not null default 0,
  status            animal.outbox_status not null default 'PENDIENTE',
  provider_id       text unique,                           -- wamid / message-id
  last_error        text,
  sent_at           timestamptz,
  delivered_at      timestamptz,
  read_at           timestamptz,
  created_at        timestamptz not null default now(),
  unique (appointment_id, kind, sequence, channel)         -- idempotencia
);
create index contact_outbox_pendientes_idx on animal.contact_outbox (scheduled_at) where status = 'PENDIENTE';

-- Mensajes entrantes (webhook). provider_id único = deduplicación de reintentos de Meta.
create table animal.contact_inbound (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references animal.organizations (id) on delete cascade,
  appointment_id   uuid references animal.appointments (id) on delete set null,
  outbox_id        uuid references animal.contact_outbox (id) on delete set null,
  channel          animal.contact_channel not null,
  provider_id      text not null unique,
  from_address     text not null,
  intent           text check (intent in ('CONFIRMAR','CANCELAR','REAGENDAR','OPT_OUT','DESCONOCIDO')),
  body             text,
  raw              jsonb,
  handled_by       uuid references animal.usuarios (id) on delete set null,
  handled_at       timestamptz,
  received_at      timestamptz not null default now()
);

-- Token opaco por cita para botones y links (no se expone el uuid de la cita).
create table animal.appointment_tokens (
  token_hash      text primary key,                       -- sha256 del token
  appointment_id  uuid not null references animal.appointments (id) on delete cascade,
  expires_at      timestamptz not null,
  used_at         timestamptz
);

-- RPC: libera las citas no confirmadas vencidas (reglas R6, R7, R8).
-- create function animal.release_unconfirmed_appointments() returns int ...
--   update appointments set status='CANCELADA', cancel_reason='Liberada: sin confirmación'
--    where status='RESERVADA' and confirm_deadline < now() and not auto_release_exempt
--      and coalesce(payment_status,'') <> 'PAGADO'
--      and exists (select 1 from contact_outbox o where o.appointment_id = id
--                   and o.kind='RECORDATORIO' and o.status in ('ENTREGADO','LEIDO'))
--   + inserta en contact_tasks las que no cumplen el exists (escalar).
```

### `0016_contactos_agentes.sql` (Fase 2)

```sql
create type animal.contact_task_status as enum ('ABIERTA', 'EN_CURSO', 'RESUELTA', 'DESCARTADA');

-- Cola de trabajo del agente: escalamientos, texto libre, reagendamientos, no-shows.
create table animal.contact_tasks (
  id, organization_id, branch_id, appointment_id, client_id,
  reason text check (reason in ('NO_ENTREGADO','PAGADA_SIN_CONFIRMAR','TEXTO_LIBRE','REAGENDAR','NO_ASISTIO','ENCUESTA_BAJA','LLAMADA_PERDIDA')),
  priority smallint, status animal.contact_task_status, assigned_to uuid, due_at timestamptz,
  outcome text, created_at, closed_at ...
);

-- Registro de cada intento de llamada (manual o voicebot).
create table animal.call_attempts (
  id, organization_id, task_id, appointment_id, agent_id, direction ('SALIENTE','ENTRANTE'),
  started_at, ended_at, result ('CONTESTA','NO_CONTESTA','OCUPADO','BUZON','NUMERO_ERRONEO'),
  recording_url text, recording_expires_at timestamptz, provider_call_id text unique ...
);

-- Encuestas post-atención.
create table animal.satisfaction_surveys (
  id, organization_id, visit_id unique, staff_id, score smallint check (score between 0 and 10),
  comment text, sent_at, answered_at ...
);
```

### `0017_fila_totems.sql` (Fase 3)

```sql
-- Boxes / mesones por sucursal y las áreas que atiende cada uno.
create table animal.service_points (
  id, organization_id, branch_id, name text,              -- "Box 2", "Mesón peluquería"
  categories animal.service_category[] not null, is_active boolean ...
);

-- Dispositivos (tótem / pantalla) autenticados por token; sin usuario humano.
create table animal.kiosk_devices (
  id, organization_id, branch_id, kind text check (kind in ('TOTEM','PANTALLA')),
  name text, token_hash text unique, last_seen_at timestamptz, revoked_at timestamptz ...
);

-- Contador atómico por sucursal/día/prefijo (insert ... on conflict do update returning).
create table animal.queue_counters (
  branch_id uuid, date date, prefix text, last_number int not null default 0,
  primary key (branch_id, date, prefix)
);

create type animal.queue_priority as enum ('URGENCIA', 'URGENCIA_SOLICITADA', 'PREFERENTE', 'NORMAL');
create type animal.ticket_status  as enum ('EN_ESPERA', 'LLAMADO', 'EN_ATENCION', 'FINALIZADO', 'AUSENTE', 'ANULADO');

create table animal.queue_tickets (
  id, organization_id, branch_id, date date, code text,     -- 'P-014'
  category animal.service_category, priority animal.queue_priority,
  appointment_id uuid, visit_id uuid, pet_name text, staff_id uuid,
  status animal.ticket_status, service_point_id uuid,
  issued_at, called_at, call_count smallint default 0, started_at, finished_at,
  source text check (source in ('TOTEM','RECEPCION')),
  unique (branch_id, date, code)
);
create index queue_tickets_fila_idx on animal.queue_tickets (branch_id, date, status, category);

-- RPC: animal.call_next_ticket(p_branch, p_service_point, p_user) aplica el orden T7
-- en una transacción con FOR UPDATE SKIP LOCKED (dos boxes no llaman al mismo ticket).
```

---

## 3. Matriz de integración y APIs

### 3.1 Componentes

```
                          ┌─────────────────────── AWS ───────────────────────────┐
 Meta WhatsApp Cloud ◄────┤ fn despachador (schedule 5 min)                        │
   API (o BSP)            │   ├─ release_unconfirmed_appointments()                │
        │  webhook        │   ├─ programa recordatorios/encuestas faltantes        │
        ▼                 │   └─ toma contact_outbox PENDIENTE → envía por canal   │
 POST /webhooks/whatsapp ─┤                                                        │
                          │ fn api (existente, handler.js)                         │──► Supabase Postgres
 Tótem (navegador kiosko)─┤   /totem/*    (token de dispositivo)                   │    (esquema animal)
 Pantalla sala (TV) ──────┤   /pantalla/* (token de dispositivo, polling 3 s)      │
 Panel agente / Recepción─┤   /contactos/*, /fila/*, /contactabilidad/* (JWT)      │
 Tutor (link)  ───────────┤   /c/:token/* (token de cita, público)                 │
                          └────────────────────────────────────────────────────────┘
```

Abstracción de canales en `src/lib/canales/` con interfaz única
`enviar({ canal, destino, plantilla, variables }) → { providerId }`:
`whatsapp.js` (Meta Cloud API), `email.js` (reutiliza `mailer.js`),
`sms.js` (respaldo, C3), `voz.js` (Fase 2) y `mock.js` para
desarrollo (`CANAL_PROVEEDOR=mock` registra en log y simula entregas).

**Telefonía del call center (Fase 2): integrar, no construir.** Lo que pide
[CHG] —llamadas entrantes y salientes a fijos y celulares, traspaso,
mensajes grabados, fila telefónica de hasta 40 llamadas con anuncio de
posición, grabación y auditoría, registro de llamadas perdidas, monitoreo en
tiempo real— es un ACD completo. Construirlo sobre Lambda no tiene sentido;
se integra una plataforma de contact center en la nube:

- **Recomendado: Amazon Connect**, por estar en la misma cuenta AWS del backend: cobro por minuto, colas con anuncio de posición, grabaciones en S3 (la retención se aplica con una *lifecycle rule*), softphone web embebible en el panel (Streams API) y eventos de llamada hacia una Lambda. Alternativa: Twilio Flex / Programmable Voice.
- **Portal Animal es el dueño de los datos de negocio** (tutor, mascota, cita, tarea); la plataforma de voz es dueña de la llamada. Se conectan por:
  - *Screen pop* [CHG, "individualización automática"]: al entrar una llamada, el flujo consulta `GET /voz/identificar?telefono=` (cruce por `phone_digits`) y el panel del agente abre la ficha del tutor, sus mascotas y sus próximas citas.
  - Eventos de llamada (contestada, abandonada, transferida, grabación lista) → `POST /webhooks/voz` → `call_attempts`.
  - Voicebot de confirmación (DTMF 1 confirma / 2 cancela / 3 agente) → mismo servicio de transición que el webhook de WhatsApp.
- **Número:** [CHG] exige conservar el número actual o dar una línea alternativa. En una veterinaria eso es el número que los clientes ya conocen: se evalúa portarlo al proveedor o desviar llamadas a un número nuevo. Verificar con el proveedor la disponibilidad de números chilenos y la portabilidad antes de comprometerlo.

**Cola de sincronización [SFE 5.9]:** las bases piden que, si el sistema
clínico no está disponible, la plataforma encole y sincronice después. En
Portal Animal la agenda y la ficha son internas, así que el riesgo se da al
revés: si **Meta, el SMS o la telefonía** fallan, el `contact_outbox` retiene
y reintenta, y los webhooks entrantes se aceptan aunque la cita ya no esté en
estado `RESERVADA` (se registran y se resuelven con R8/R10). El caso del
tótem sin conexión está en T12.

### 3.2 Endpoints

Convenciones del repo: rutas en castellano, `handler()` + `HttpError`, permisos `modulo.accion`.

#### A. Agenda disponible

| Método y ruta | Auth | Uso |
|---|---|---|
| `GET /citas/disponibles?desde&hasta&branchId&staffId&cargo&specialtyId&serviceId` | JWT `citas.ver` | **Ya existe.** Lo usa el panel del agente para reagendar. |
| `GET /c/:token/turnos?desde&hasta` | Token de cita | Turnos libres del **mismo servicio y sucursal** de la cita (reutiliza `turnosLibres()`), máx. 14 días. Para el link "Reagendar" de WhatsApp. |
| `POST /c/:token/reagendar` `{ date, start_time, staff_id }` | Token de cita | Toma el turno nuevo y cancela el anterior en una transacción (RPC). 409 si el turno se tomó. |

Respuesta de `GET /c/:token/turnos`:
```json
{
  "cita": { "mascota": "Bobi", "servicio": "Baño y corte", "sucursal": "Ñuñoa", "fecha": "2026-10-22", "hora": "10:30" },
  "dias": [ { "fecha": "2026-10-23", "turnos": [ { "inicio": "09:00", "fin": "10:00", "staffId": "…", "profesional": "Camila R." } ] } ]
}
```

#### B. Check-in presencial (tótem)

Auth: header `Authorization: Device <token>`; el token identifica organización + sucursal (`kiosk_devices`). Rate limit por dispositivo (p. ej. 20 búsquedas/min) contra enumeración de RUT.

**`POST /totem/buscar`**
```json
// request
{ "tipo": "RUT", "valor": "12.345.678-5" }      // o { "tipo": "TELEFONO", "valor": "+56 9 8765 4321" }
// 200
{
  "citas": [
    { "ref": "q7Xk…", "mascota": "Bobi", "area": "GROOMING", "servicio": "Baño y corte",
      "hora": "10:30", "profesional": "Camila R.", "tutor": "D. C.", "puedeCheckin": true }
  ],
  "permiteEspontaneo": true
}
```
- RUT: se valida dígito verificador, se canoniza y se busca `clients.national_id`; teléfono: últimos 8–9 dígitos contra `phone_digits` / `contact_phone_digits`.
- Solo citas `RESERVADA`/`CONFIRMADA` de **hoy** en la sucursal del dispositivo. `ref` es un identificador efímero firmado (no el uuid).
- `puedeCheckin = false` fuera de la ventana T1 (se muestra "acércate a recepción").

**`POST /totem/checkin`**
```json
// request
{ "ref": "q7Xk…", "preferente": false }
// 201
{ "ticket": { "code": "P-014", "mascota": "Bobi", "area": "GROOMING", "enEspera": 2 }, "atencionId": "…" }
```
Efectos (en una transacción/RPC): crea `visits` con la lógica de `recepcion.crear` → cita `LLEGO`; si la cita estaba `RESERVADA` la marca confirmada (`confirmation_channel = 'PRESENCIAL'`); emite `queue_tickets`. Idempotente: un segundo check-in de la misma cita devuelve el mismo ticket (índice `visits_cita_unica`).

**`POST /totem/espontaneo`** `{ "area": "VET", "urgencia": true, "preferente": false, "mascota": "Luna" }` → ticket `U-003` con prioridad `URGENCIA_SOLICITADA` y alerta en recepción.

#### C. Fila y pantalla

| Método y ruta | Auth | Uso |
|---|---|---|
| `GET /fila?branchId&area` | JWT `fila.ver` | Fila ordenada según T7, con tiempos de espera. |
| `POST /fila/siguiente` `{ servicePointId }` | JWT `fila.editar` | RPC `call_next_ticket`. Devuelve el ticket llamado. |
| `POST /fila/:id/llamar` `{ servicePointId }` | JWT `fila.editar` | Llamar un ticket puntual. |
| `POST /fila/:id/rellamar` · `/atender` · `/ausente` · `/finalizar` · `/prioridad` `{ priority }` | JWT `fila.editar` | Transiciones; `/prioridad` confirma o rechaza la urgencia solicitada (T5). |
| `GET /pantalla/llamados?desde=<cursor>` | Device (`PANTALLA`) | Últimos 6 llamados + nuevos desde el cursor. Respuesta liviana con `ETag`; la TV hace polling cada 3 s. |

Respuesta de `/pantalla/llamados`:
```json
{ "cursor": "2026-10-19T14:02:11.120Z",
  "nuevos": [ { "code": "P-014", "texto": "Atención Peluquería: Bobi → Box 2", "box": "Box 2", "area": "GROOMING", "llamado": 1 } ],
  "recientes": [ … ] }
```
La pantalla anuncia con `speechSynthesis` del navegador (es-CL) + sonido; no requiere servidor de audio.

#### D. Webhook WhatsApp

| Método y ruta | Uso |
|---|---|
| `GET /webhooks/whatsapp?hub.mode&hub.verify_token&hub.challenge` | Verificación de Meta: compara `hub.verify_token` con `WHATSAPP_VERIFY_TOKEN` y devuelve `hub.challenge` en texto plano. |
| `POST /webhooks/whatsapp` | Mensajes y estados. |

Procesamiento del `POST`:
1. **Firma:** HMAC-SHA256 del cuerpo crudo (`rawBody(event)` de `lib/http.js`) con `WHATSAPP_APP_SECRET`, comparado en tiempo constante con `X-Hub-Signature-256`. Si no coincide → 401.
2. **Responder 200 rápido** (Meta reintenta si tarda o falla). Procesamiento idempotente por `provider_id` (`wamid`) único.
3. `statuses[]` → actualiza `contact_outbox` (`ENVIADO/ENTREGADO/LEIDO/FALLIDO`). Un estado nunca retrocede (`LEIDO` no vuelve a `ENTREGADO`).
4. `messages[]`:
   - Botón (`interactive.button_reply.id` o `button.payload`) con formato `CONFIRMAR:<token>` / `CANCELAR:<token>` / `REAGENDAR:<token>` → resuelve la cita por `token_hash`.
   - Texto libre → busca la cita por `context.id` (respuesta a nuestro mensaje) o, si no, por el teléfono (`from`) contra la última cita `RESERVADA` futura; interpreta intención (R11).
   - `STOP`/`BAJA` → `whatsapp_opt_out_at`, cancela envíos pendientes.
5. Aplica la transición con condición de estado (`update … where id = $1 and status = 'RESERVADA'`) y encola la respuesta al tutor (`CONFIRMACION_RESP`).

Ejemplo de payload de entrada (resumido):
```json
{ "entry": [ { "changes": [ { "value": {
  "messages": [ { "id": "wamid.HBg…", "from": "56987654321", "type": "interactive",
                  "context": { "id": "wamid.ORIG…" },
                  "interactive": { "type": "button_reply", "button_reply": { "id": "CONFIRMAR:9f2c…", "title": "Confirmar" } } } ],
  "statuses": [ { "id": "wamid.ORIG…", "status": "read", "timestamp": "1760882531" } ] } } ] } ] }
```

Equivalentes para otros canales: `POST /c/:token/confirmar` y `POST /c/:token/cancelar` (link en el email y página pública mínima) y, en Fase 2, `POST /webhooks/voz` del proveedor de telefonía.

**Plantillas Meta a aprobar** (categoría *utility*):
- `recordatorio_cita` — "Hola {{1}}, te recordamos la hora de {{2}} para {{3}} el {{4}} a las {{5}} en {{6}}." Botones: *Confirmar* · *Cancelar* · *Reagendar*.
- `cita_liberada` — aviso de liberación + link para reagendar.
- `encuesta_atencion` — NPS 0–10 (lista interactiva) tras la atención.

#### E. Administración y panel del agente

| Método y ruta | Auth |
|---|---|
| `GET /contactabilidad/config?branchId` · `PUT /contactabilidad/config` | `contactabilidad.ver` / `.editar` |
| `GET /contactabilidad/metricas?desde&hasta&branchId` (tasa de confirmación, liberaciones, no-show, NPS) | `contactabilidad.ver` |
| `GET /contactos/tareas?estado&motivo` · `POST /contactos/tareas/:id/tomar` · `PUT /contactos/tareas/:id` `{ outcome, status }` | `contactos.*` |
| `POST /contactos/tareas/:id/llamadas` (registra intento o inicia click-to-call) | `contactos.crear` |
| `GET /contactos/bandeja` (inbound sin intención) · `POST /contactos/bandeja/:id/responder` | `contactos.*` |
| `POST /dispositivos` · `DELETE /dispositivos/:id` (alta de tótem/pantalla; el token se muestra **una vez**) | ORG_ADMIN |
| `PUT /tutores/:id/consentimiento` `{ whatsapp: true }` | `tutores.editar` |

Nuevas variables de entorno (`serverless.yml`): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `CANAL_PROVEEDOR`, `PUBLIC_LINK_URL`; en Fase 2, credenciales del proveedor de voz.

---

## 4. Diccionario de parámetros y SLAs

Se guardan en `contact_settings.settings` (organización, con override por sucursal) y se validan en el backend con rangos. ⚠ = valor típico de mercado a contrastar con el documento de referencia.

### 4.1 Confirmación y recordatorios

| Clave | Default | Rango | Descripción |
|---|---|---|---|
| `confirmacion_activa` | `false` | bool | Interruptor general del módulo por sucursal. |
| `canales_orden` | `["WHATSAPP","EMAIL"]` | lista | Orden de canales; si el primero no aplica (sin consentimiento/dato) se usa el siguiente. |
| `recordatorio_1_horas` | `48` ⚠ | 2–168 | Anticipación del primer recordatorio. |
| `recordatorio_2_horas` | `24` ⚠ | 1–72, < rec. 1 | Segundo recordatorio solo si no hubo respuesta. `0` = desactivado. |
| `plazo_confirmacion_horas` | `12` ⚠ | 1–48 | Antes de la cita; vencido se aplica `accion_sin_respuesta`. |
| `accion_sin_respuesta` | `ESCALAR` | `LIBERAR` · `ESCALAR` · `NADA` | Arrancar en `ESCALAR` el primer mes y pasar a `LIBERAR` con datos de entrega reales. |
| `liberar_solo_si_entregado` | `true` | bool | Regla R6. No recomendable desactivarlo. |
| `excluir_pagadas` | `true` | bool | Regla R7. |
| `reintentos_mensaje` | `2` ⚠ | 0–5 | Reintentos ante error técnico de envío (no ante falta de respuesta). |
| `intervalo_reintento_min` | `30` | 5–240 | Espera entre reintentos (backoff ×2). |
| `horario_envio` | `{"desde":"09:00","hasta":"20:00","domingo":false}` | — | Regla R9. |
| `mensaje_inmediato_si_menos_de_horas` | `= recordatorio_1_horas` | — | Regla R2. |
| `lista_espera_activa` | `false` | bool | Regla R12. |
| `sms_respaldo` | `true` [SFE] | bool | Usar SMS cuando WhatsApp falla o no aplica (C3). |
| `rut_enmascarado` | `true` [SFE] | bool (fijo) | Formato `12.***.***-5` en toda comunicación (C4). |
| `contingencia_aviso_automatico` | `false` | bool | Si `true`, al crear un bloqueo con citas afectadas se notifican sin preguntar (C1). |
| `campanas_tope_diario` | `500` ⚠ | 0–10.000 | Máximo de mensajes de campañas multigrupo por día y organización (C2). |

### 4.2 Voz / call center (Fase 2)

| Clave | Default | Rango | Descripción |
|---|---|---|---|
| `reintentos_llamada` | `3` ⚠ | 0–6 | Intentos por tarea antes de cerrarla como "no contactable". |
| `intervalo_llamada_min` | `120` ⚠ | 15–1440 | Separación mínima entre intentos al mismo número. |
| `horario_llamadas` | `09:00–19:00` lun–sáb | — | Ventana para llamadas salientes. |
| `grabar_llamadas` | `false` | bool | Requiere aviso al inicio de la llamada. |
| `retencion_grabaciones_dias` | `90` ⚠ | 7–365 | Borrado automático del audio y anulación de `recording_url`. |
| `retencion_mensajes_dias` | `365` ⚠ | 30–1825 | Purga de `contact_inbound.raw`/`body` (se conservan métricas agregadas). |
| `sla_tarea_horas` | `{"NO_ENTREGADO":2,"TEXTO_LIBRE":1,"REAGENDAR":4,"NO_ASISTIO":24}` | — | Vencimiento (`due_at`) de cada tipo de tarea. |
| `agentes_simultaneos` | según plan (ref. 18 + 2 supervisores [CHG]) | 1–50 | Licencias concurrentes del panel; perfiles `AGENTE` y `SUPERVISOR`, más perfiles nominales por sucursal [CHG]. |
| `cola_telefonica_capacidad` | `40` [CHG] | 1–100 | Llamadas en espera; sobre eso, mensaje grabado + ofrecer devolución de llamada. |
| `anuncio_posicion_fila` | `true` [CHG] | bool | "Usted es el número 3 en la fila". |
| `mensajes_grabados` | — [CHG] | audios | Bienvenida, fuera de horario, fila llena, aviso de grabación. |
| `bolsa_minutos_mes` | `5.000` [CHG] | 0–100.000 | Minutos incluidos (locales y móviles); se mide el consumo del mes. |
| `alerta_consumo_minutos_pct` | `80` ⚠ | 50–100 | Avisa al administrador antes de pasar a tarifa por minuto adicional. |
| `registrar_llamadas_perdidas` | `true` [CHG] (fijo) | — | Toda llamada abandonada crea tarea `LLAMADA_PERDIDA` para devolverla. |

### 4.3 Atención presencial (Fase 3)

| Clave | Default | Rango | Descripción |
|---|---|---|---|
| `checkin_antes_min` | `60` | 0–240 | Desde cuándo se acepta check-in (T1). |
| `tolerancia_atraso_min` | `15` ⚠ | 0–120 | Hasta cuándo; después deriva a recepción. |
| `no_asistio_automatico` | `false` | bool | Marcar `NO_ASISTIO` al vencer la tolerancia (R13). |
| `preferente_activo` | `true` | bool | Política T6. |
| `ratio_preferente` | `3` | 1–10 | Cada N preferentes, un normal (anti-inanición T7). |
| `espera_max_min` | `45` ⚠ | 10–180 | Sobre esto el ticket sube al tope y alerta. |
| `rellamados_max` | `3` | 1–5 | Antes de pasar a `AUSENTE` (T8). |
| `prefijos` | `{"VET":"V","GROOMING":"P","TRAINING":"A","URGENCIA":"U"}` | — | Numeración T4. |
| `anuncio_voz` | `true` [SFE] | bool | Señal sonora + lectura del llamado en el visor. |
| `totem_offline` | `true` [SFE] | bool | Operación sin conexión (T12). |
| `totem_bloque_numeros` | `50` ⚠ | 10–500 | Números reservados por tótem para emitir sin conexión. |
| `preferente_criterios` | `["MAYOR_60","DISCAPACIDAD"]` [SFE, Ley 21.168] | lista | Criterios que habilitan atención preferente (T6). |

### 4.4 Encuesta post-atención

| Clave | Default | Rango | Descripción |
|---|---|---|---|
| `encuesta_activa` | `false` | bool | Se dispara al `close_visit`. |
| `encuesta_horas_despues` | `2` ⚠ | 0–72 | Retardo del envío (respetando `horario_envio`). |
| `encuesta_tipo` | `NPS` | `NPS` · `CSAT` | NPS 0–10 o CSAT 1–5. |
| `encuesta_umbral_alerta` | `6` | 0–10 | Nota ≤ umbral crea tarea `ENCUESTA_BAJA` para el agente. |
| `encuesta_frecuencia_max_dias` | `30` | 0–365 | No encuestar al mismo tutor más de una vez en ese periodo. |

### 4.5 SLAs / KPIs del módulo (panel de métricas)

| Indicador | Meta inicial ⚠ | Fórmula |
|---|---|---|
| Contactos efectivos [SFE] | métrica base (y unidad de cobro posible) | respuestas del tutor + llamadas contestadas, ver §1.1 |
| Llamadas perdidas devueltas [CHG] | ≥ 90 % en el día | tareas `LLAMADA_PERDIDA` cerradas ÷ abandonadas |
| Abandono en fila telefónica | ≤ 10 % ⚠ | abandonadas ÷ entrantes |
| Disponibilidad del servicio [SFE] | ≥ 99,5 % mensual ⚠ | interrupción total = incidente crítico |
| Soporte remoto [CHG] | primer contacto ≤ 8 h hábiles | desde el reporte del incidente |
| Soporte presencial (tótem/visor) [CHG] | ≤ 48 h tras el soporte remoto | solo hardware en sucursal |
| Tasa de entrega WhatsApp | ≥ 95 % | entregados ÷ enviados |
| Tasa de confirmación | ≥ 70 % | confirmadas ÷ citas con recordatorio |
| Tasa de inasistencia (no-show) | reducir ≥ 30 % vs. línea base | `NO_ASISTIO` ÷ citas del periodo |
| Cupos liberados reocupados | ≥ 40 % | liberadas con nueva cita en el mismo turno ÷ liberadas |
| Tiempo de primera respuesta a texto libre | ≤ 15 min en horario hábil | `handled_at − received_at` |
| Tareas de agente dentro de SLA | ≥ 90 % | cerradas antes de `due_at` |
| Espera en sala (check-in → llamado) | p80 ≤ 15 min con cita | `called_at − issued_at` |
| NPS | ≥ 50 | %promotores − %detractores |

### 4.6 Cumplimiento

- **Consentimiento explícito** para WhatsApp (casilla en ficha/portal, guardando fecha) y salida con `STOP` — exigencia de Meta y de la normativa chilena de datos personales (Ley 19.628 y la nueva Ley 21.719, con entrada en vigencia a fines de 2026: finalidad, minimización, plazos de conservación, derecho de oposición).
- **Grabaciones:** aviso al inicio, retención acotada, acceso solo por rol.
- **Tótem y pantalla:** minimización de datos (T2, T3); sin datos personales guardados en el equipo (T12).
- **Filtración de datos = incidente crítico.** [SFE] lo trata como causal de término de contrato. Se adopta igual: grabaciones y mensajes cifrados en reposo, acceso a grabaciones solo para `SUPERVISOR` y siempre auditado (quién escuchó qué y cuándo) [CHG], y nada de RUT ni teléfonos completos en los logs.

---

## 5. Backlog

Agente sugerido entre corchetes (ADF): **DB** db-architect · **BE** backend-dev · **FE** frontend-dev · **QA** qa-tester · **SEC** security-reviewer.

### Fase 1 — Recordatorios y confirmación por WhatsApp (Quick Win)

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 1.0 | **Trámites de Meta en paralelo desde el día 1:** Business Manager verificado, número dedicado, alta de plantillas `recordatorio_cita`, `cita_liberada`. [negocio] | Plantillas aprobadas (suele tardar días; es el camino crítico). |
| 1.1 | Migración `0015_contactabilidad.sql` + RPC `release_unconfirmed_appointments()` y `claim_outbox(limit)` con `SKIP LOCKED`. [DB] | Migración aplicada y reversible; RPC no toca citas `CONFIRMADA`/`PAGADO`. |
| 1.2 | `lib/telefono.js`: normalizar a E.164 Chile (`+569XXXXXXXX`), con tests. [BE] | `"9 8765 4321"`, `"+56-9-87654321"`, `"987654321"` → `+56987654321`. |
| 1.3 | `lib/canales/` con `mock`, `email` (reusa `mailer.js`) y `whatsapp` (Cloud API). [BE] | `CANAL_PROVEEDOR=mock` permite probar todo el flujo sin Meta. |
| 1.4 | Programación: al crear/mover/cancelar una cita (`citas.js`, `portal.js`) calcular `confirm_deadline`, `auto_release_exempt` y (re)generar/cancelar filas de `contact_outbox`. [BE] | Mover una cita reprograma sus recordatorios; cancelarla los cancela. |
| 1.5 | Función `despachador` en `serverless.yml` (evento `schedule: rate(5 minutes)`): liberar → tomar outbox → enviar → reintentos con backoff. [BE] | Dos ejecuciones simultáneas no envían el mismo mensaje. |
| 1.6 | Webhook `GET/POST /webhooks/whatsapp` con verificación HMAC, idempotencia por `wamid`, estados y botones. [BE] | Firma inválida → 401; reenvío del mismo evento no duplica efectos. |
| 1.7 | Links públicos `/c/:token/confirmar|cancelar|turnos|reagendar` + página mínima en el frontend. [BE+FE] | Funciona desde el email; token expira después de la cita. |
| 1.8 | Llamar `release_unconfirmed_appointments()` junto a `liberarReservasVencidas()` en `citasVigentes()`. [BE] | Un cupo vencido aparece libre aunque el job no haya corrido. |
| 1.9 | Consentimiento: casilla en ficha de tutor y en el portal; `PUT /tutores/:id/consentimiento`; manejo de `STOP`. [BE+FE] | Sin consentimiento no se envía WhatsApp. |
| 1.10 | Pantalla **Configuración → Contactabilidad** (parámetros §4.1, por organización y sucursal) + permisos `contactabilidad.*` en `permisos.js`. [FE+BE] | Validación de rangos en backend; diálogos con `useDialogo`. |
| 1.11 | En la Agenda: insignia de estado de contacto por cita (enviado / entregado / leído / confirmó / canceló / sin respuesta). [FE] | Visible en la vista diaria. |
| 1.12 | Métricas básicas: **contactos efectivos**, confirmación, entrega, liberadas, no-show. [BE+FE] | `GET /contactabilidad/metricas`. |
| 1.12b | Notificación de contingencia: al crear un `BLOQUEO` con citas afectadas, listar y notificar con link de reagendamiento (C1). [BE+FE] | Ninguna cita se cancela sin acción del usuario. |
| 1.12c | Canal SMS de respaldo y RUT enmascarado en plantillas (C3, C4). [BE] | Mensaje fallido por WhatsApp sale por SMS dentro de la misma ventana. |
| 1.13 | Revisión de seguridad (webhook, tokens públicos, datos en logs) y QA de punta a punta con mock y con número de prueba de Meta. [SEC+QA] | Sin hallazgos críticos. |
| 1.14 | Piloto en una sucursal con `accion_sin_respuesta = ESCALAR` 2–4 semanas; luego activar `LIBERAR`. [negocio] | Línea base de no-show medida. |

### Fase 2 — Panel de agentes (call center / recepción)

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 2.1 | Migración `0016` (tareas, intentos de llamada, encuestas). [DB] | — |
| 2.2 | Generación de tareas: no entregados, pagadas sin confirmar, texto libre, reagendar, no-show, encuesta baja. [BE] | Cada escalamiento de Fase 1 aparece como tarea con `due_at`. |
| 2.3 | API `/contactos/tareas` y `/contactos/bandeja` con asignación (tomar/soltar) sin colisiones. [BE] | Dos agentes no toman la misma tarea. |
| 2.4 | Vista **Contactos**: cola priorizada por vencimiento, ficha lateral del tutor/mascota/cita, acciones confirmar / cancelar / reagendar (reusa `GET /citas/disponibles`) y registrar resultado de llamada. [FE] | Reagendar sin salir de la vista. |
| 2.5 | Bandeja WhatsApp: responder texto libre dentro de la ventana de 24 h de Meta (fuera de ella solo plantillas). [BE+FE] | El sistema bloquea texto libre fuera de ventana. |
| 2.6 | Integración con la plataforma de voz (Amazon Connect recomendado): softphone embebido en el panel, llamadas entrantes y salientes, traspaso, fila de 40 con anuncio de posición, mensajes grabados [CHG]. [BE+FE] | Un agente recibe, transfiere y devuelve una llamada desde el panel. |
| 2.6b | *Screen pop*: `GET /voz/identificar?telefono=` abre la ficha del tutor al entrar la llamada [CHG]. [BE+FE] | Ficha visible antes de contestar. |
| 2.6c | `POST /webhooks/voz`: llamadas contestadas, abandonadas (→ tarea `LLAMADA_PERDIDA`), transferidas y grabaciones [CHG]. [BE] | Cada llamada abandonada genera tarea. |
| 2.7 | Voicebot/IVR saliente para el residuo sin WhatsApp [SFE] (DTMF 1 confirma / 2 cancela / 3 agente). [BE] | Mismo servicio de transición que el webhook de WhatsApp. |
| 2.7b | Perfiles `AGENTE` y `SUPERVISOR`; vista del supervisor en tiempo real (agentes conectados, fila, abandonadas), reportes y gráficos, auditoría de grabaciones con registro de acceso [CHG]. [BE+FE] | Escuchar una grabación deja traza. |
| 2.7c | Medición de la bolsa de minutos y alerta de consumo [CHG]. [BE] | Aviso al 80 %. |
| 2.7d | Web chat en el portal del tutor, que entra a la misma bandeja que WhatsApp [CHG]. [BE+FE] | — |
| 2.7e | Campañas multigrupo (planes preventivos: vacunas, desparasitación) con segmentación y tope diario (C2) [CHG]. [BE+FE] | Solo a tutores con consentimiento. |
| 2.8 | Encuesta post-atención disparada desde `close_visit` + reporte NPS por sucursal y profesional. [BE+FE] | Respeta `encuesta_frecuencia_max_dias`. |
| 2.9 | Job de retención: purga grabaciones y cuerpos de mensajes según §4.2. [BE] | Ejecuta a diario; deja auditoría. |
| 2.10 | Permisos `contactos.*`, SLAs y tablero de agentes. [BE+FE] + QA/SEC. | — |

### Fase 3 — Tótems y pantallas de sala de espera

| # | Tarea | Criterio de aceptación |
|---|---|---|
| 3.1 | Migración `0017` (boxes, dispositivos, contador, tickets) + RPC `issue_ticket` y `call_next_ticket`. [DB] | Correlativo sin saltos ni duplicados bajo concurrencia. |
| 3.2 | Configuración: boxes por sucursal y alta/revocación de dispositivos (token mostrado una vez). [BE+FE] | Token revocado → 401 inmediato. |
| 3.3 | Extraer de `recepcion.crear` la creación de atención a una función compartida para el check-in del tótem. [BE] | Recepción sigue funcionando igual (regresión QA). |
| 3.4 | API tótem `/totem/buscar|checkin|espontaneo` con validación de RUT, ventana T1, rate limit y datos enmascarados. [BE] | Pruebas de enumeración: no revela si un RUT existe. |
| 3.5 | App tótem (ruta del frontend en modo kiosko, pantalla completa, teclado numérico propio, accesible: letra grande, alto contraste); impresión de ticket térmico vía `window.print` con CSS 80 mm, o QR en pantalla. [FE] | Check-in en ≤ 3 toques con cita. |
| 3.6 | Fila de recepción: vista por área, "Llamar siguiente" por box, re-llamar, ausente, confirmar urgencia. [FE+BE] | Orden T7 verificado con casos de prueba. |
| 3.7 | Pantalla de sala: ruta `/pantalla` con polling 3 s, últimos llamados, voz `speechSynthesis` es-CL, reconexión automática. [FE] | Muestra solo mascota + área + box. |
| 3.7b | Derivación de tickets entre módulos con historial (T11) [SFE]. [BE+FE] | El ticket conserva su prioridad al derivarse. |
| 3.7c | Tótem sin conexión: PWA con bloque de números reservado y cola local de emisiones, sincronización y resolución de conflictos (T12) [SFE]. [FE+BE] | Prueba con red cortada 30 min: sin números duplicados al volver. |
| 3.8 | Métricas de espera y atención por área/box. [BE+FE] | p80 de espera en el panel. |
| 3.9 | (Opcional) Check-in desde la app móvil Flutter por geocerca/QR de la sucursal, mismo endpoint. [mobile] | — |
| 3.10 | QA en sitio con hardware real (tótem, impresora, TV) + SEC. | — |

---

## 6. Decisiones abiertas

1. **Proveedor WhatsApp:** Meta Cloud API directo (más barato, más trámite) vs. un BSP (Twilio, Infobip, Gupshup; soporte y panel, mayor costo). El diseño lo aísla en `lib/canales/whatsapp.js`.
2. **Un número por organización o uno compartido de la plataforma:** compartido es más simple para partir, pero el nombre visible será "Portal Animal" y no el de la clínica. Multi-número requiere Embedded Signup de Meta.
3. **Liberación por defecto:** se recomienda partir en `ESCALAR` y activar `LIBERAR` con datos del piloto.
4. **Plataforma de voz:** Amazon Connect (recomendado, misma cuenta AWS) o Twilio. El panel de agentes de Fase 2 puede salir sin voz integrada (solo WhatsApp + `tel:`) si se quiere adelantar.
5. **Hardware del tótem:** pantalla táctil + impresora térmica de autocorte como en [SFE], o tablet en modo kiosko con QR (sin papel) para clínicas pequeñas. Define también quién da el soporte presencial de 48 h.
6. **Modelo de cobro:** [SFE] separa *contactabilidad por contacto efectivo* de *filas por tarifa mensual fija* (software + tótems + visores). Es un buen modelo para planes del SaaS: módulo de confirmación por uso y módulo presencial por suscripción.

---

## 7. Trazabilidad con las referencias

| Requisito de referencia | Fuente | Adaptación a Portal Animal | Dónde | Fase |
|---|---|---|---|---|
| Agendamiento y confirmación de horas | CHG Objeto · SFE 5 | Recordatorios con botones, confirmación y cancelación | §1.1 R1–R4 | 1 |
| Cancelación con motivo, reagendamiento | SFE 5 | Botones Cancelar/Reagendar, `cancel_reason`, link de turnos | R4, R5, §3.2 A | 1 |
| Actualización en tiempo real del estado (confirmada, cancelada, liberada) | SFE 5.9 | Estados existentes de `appointments`; liberada = `CANCELADA` con motivo | R3–R6 | 1 |
| Recordatorios con RUT enmascarado | SFE 5 | Plantillas con RUT enmascarado | C4 | 1 |
| Notificaciones de contingencia | SFE 5 | Aviso masivo de citas afectadas por un bloqueo | C1 | 1 |
| WhatsApp API verificado, SMS de respaldo, correo | SFE 5 · CHG Mensajería | Canales `WHATSAPP`, `SMS`, `EMAIL` con orden configurable | §3.1, C3 | 1 |
| Cola local y sincronización ante caída del sistema clínico | SFE 5.9 | Outbox con reintentos; webhooks tolerantes a cambios de estado | §3.1 | 1 |
| Mensajería automática individual y **multigrupo** | CHG Mensajería | Campañas de planes preventivos | C2 | 2 |
| Web chat | CHG Mensajería | Chat en el portal del tutor | 2.7d | 2 |
| IVR / Voicebot | SFE 5 | Voicebot de confirmación (DTMF) | 2.7 | 2 |
| Llamadas entrantes y salientes, traspaso, mensajes grabados | CHG Capacidad | Plataforma de voz integrada | 2.6 | 2 |
| Fila telefónica de 40 con anuncio de posición | CHG Capacidad · Funcionalidades | `cola_telefonica_capacidad`, `anuncio_posicion_fila` | §4.2 | 2 |
| 18 agentes + 2 supervisores + perfiles nominales por establecimiento | CHG Capacidad | Licencias concurrentes; roles `AGENTE`/`SUPERVISOR` por sucursal | §4.2, 2.7b | 2 |
| Supervisión remota, reportes, gráficos, monitoreo en tiempo real | CHG Funcionalidades | Vista de supervisor y métricas | 2.7b, §4.5 | 2 |
| Registro de llamadas perdidas | CHG Funcionalidades | Tarea `LLAMADA_PERDIDA` automática | 2.6c | 2 |
| Auditoría de grabaciones | CHG Funcionalidades | Acceso solo supervisor, con traza | 2.7b, §4.6 | 2 |
| Encuestas de satisfacción | CHG Funcionalidades | NPS/CSAT post-atención | §4.4, 2.8 | 2 |
| Bolsa de 5.000 minutos y tarifa adicional | CHG Mensajería | `bolsa_minutos_mes` + alerta de consumo | §4.2, 2.7c | 2 |
| Individualización automática al recibir/realizar llamada (SINETSUR) | CHG Integración | *Screen pop* contra la ficha interna (`phone_digits`) | 2.6b | 2 |
| Conservar el número actual o línea alternativa | CHG Especificaciones | Portabilidad o desvío del número de la clínica | §3.1 | 2 |
| Tótems con pantalla táctil e impresora térmica de autocorte | SFE 6 | App tótem kiosko + ticket 80 mm | T13, 3.5 | 3 |
| Visores con señales sonoras y visuales | SFE 6 | Pantalla de sala con sonido y voz | 3.7 | 3 |
| Check-in presencial | SFE 6 | Por RUT o teléfono, crea la atención | §1.2, §3.2 B | 3 |
| Ley 21.168 de Atención Preferente | SFE 6 | Criterios de la ley como política por defecto | T6, T7 | 3 |
| Derivación a módulos | SFE 6 | Derivación de tickets entre boxes | T11, 3.7b | 3 |
| Operación fuera de línea | SFE 6 | Tótem PWA con bloque de números y cola local | T12, 3.7c | 3 |
| Soporte remoto 8 h hábiles / presencial 48 h | CHG Niveles de servicio | SLA de soporte del SaaS | §4.5 | Transversal |
| Pérdida o filtración de datos = incumplimiento crítico | SFE 8 | Controles de seguridad y auditoría | §4.6 | Transversal |

**Fuera de alcance** (propio de una licitación pública, no de un SaaS veterinario): garantía de fiel cumplimiento, multas en UTM, criterios de evaluación de ofertas, anexos de Mercado Público, UTP, auriculares para los agentes y material de difusión por cambio de número (lienzos, palomas, volantes). Sí se aprovecha la idea de fondo de este último: si la clínica cambia de número, el sistema avisa a sus tutores por WhatsApp/correo.

**Lo que las referencias no definen** (siguen como ⚠ en §4): anticipación de los recordatorios, plazo límite de confirmación, número de reintentos de mensajes y llamadas, y días de retención de grabaciones. Se proponen valores de mercado y se ajustan con los datos del piloto (tarea 1.14).
