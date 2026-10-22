# API de integración Core ↔ Contactabilidad

> Portal Animal · Versión `v1` · 2026-10-20
>
> Contrato entre el **sistema Core** (agenda de Portal Animal) y el **motor
> externo de contactabilidad** que confirma citas por WhatsApp, SMS, correo o
> voz. El motor lee la nómina de citas, informa la respuesta del tutor y
> libera los cupos no confirmados.

Base URL: `https://<api-portal-animal>/api/v1`. Todo en JSON UTF-8; fechas `AAAA-MM-DD` y horas `HH:MM` en hora local de Chile (`America/Santiago`).

---

## 1. Autenticación inter-sistema

**OAuth2 Client Credentials** (RFC 6749 §4.4).

| Opción evaluada | Decisión |
|---|---|
| API Key | Descartada: la clave viaja en cada petición y no vence. |
| **OAuth2 (Client ID + Client Secret)** | **Adoptada.** El secreto solo se usa para obtener un token de 1 hora; revocar la credencial corta el acceso al instante. Es lo que soportan de fábrica las plataformas de contact center. |
| Certificado mTLS | No por ahora: en API Gateway HTTP exige dominio propio y un truststore en S3. Se puede **sumar** después como capa de transporte, sin cambiar este contrato. |

**Alta de credenciales:** el administrador de la organización (rol `ORG_ADMIN`) las crea desde la API del portal (`POST /integraciones/credenciales { "name": "Proveedor X" }`). El `client_secret` se muestra **una sola vez**; en la base queda solo su hash. Cada credencial pertenece a **una organización**, y el motor solo ve las citas de esa organización.

### `POST /api/v1/oauth/token`

```http
POST /api/v1/oauth/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
```

También se aceptan `client_id` y `client_secret` en el cuerpo (form o JSON).

```json
200 { "access_token": "eyJ…", "token_type": "Bearer", "expires_in": 3600 }
400 { "error": "unsupported_grant_type", "error_description": "…" }
401 { "error": "invalid_client", "error_description": "Credenciales inválidas o revocadas" }
```

Las demás llamadas usan `Authorization: Bearer <access_token>`. Con un token vencido o una credencial revocada se responde `401`; el motor debe pedir un token nuevo y reintentar una vez.

---

## 2. Endpoints

### 2.1 `GET /api/v1/citas/programadas` — nómina de citas a gestionar

| Parámetro | Default | Descripción |
|---|---|---|
| `desde` | hoy | Fecha inicial. Nunca devuelve citas pasadas: hoy, solo las que aún no empiezan. |
| `hasta` | `desde` + 7 días | Rango máximo de 31 días. |
| `estado` | `RESERVADA` | `RESERVADA`, `CONFIRMADA` o ambos separados por coma. |
| `sucursal` | todas | UUID de la sucursal. |
| `pagina` / `por_pagina` | `1` / `100` | Máximo 500 por página. |

Las reservas del portal que aún están **en proceso de pago en línea** no se incluyen.

```json
200 {
  "citas": [{
    "id": "6f1c…", "fecha": "2026-10-22", "hora_inicio": "10:30", "hora_fin": "11:00",
    "estado": "RESERVADA", "pago": null, "confirmada_at": null, "canal_confirmacion": null,
    "sucursal": { "id": "…", "nombre": "Ñuñoa", "direccion": "Av. Irarrázaval 1234", "telefono": "…" },
    "profesional": { "id": "…", "nombre": "Camila Rojas" },
    "servicio": { "id": "…", "nombre": "Baño y corte" },
    "especialidad": null,
    "mascota": { "id": "…", "nombre": "Bobi" },
    "tutor": { "nombre": "Daniela Carrasco", "telefono": "9 8765 4321", "telefono_e164": "+56987654321",
               "email": "…", "rut_enmascarado": "12.***.***-5" }
  }],
  "pagina": 1, "por_pagina": 100, "total": 1
}
```

`pago = "PAGADO"` indica que la cita se pagó en línea: **no se libera** (ver §3).
`telefono_e164` es `null` cuando el número no se puede normalizar; en ese caso se usa `telefono`.

### 2.2 `POST /api/v1/citas/{id}/estado` — confirmar o cancelar

```json
{ "estado": "CONFIRMADA", "resultado": "CONFIRMA", "canal": "WHATSAPP",
  "id_externo": "wamid.HBg…", "motivo": null }
```

| Campo | Obligatorio | Valores |
|---|---|---|
| `estado` | sí | `CONFIRMADA` · `CANCELADA` |
| `resultado` | no | Código del motor según la matriz (§3). Si viene, debe corresponder al `estado`. |
| `canal` | no | `WHATSAPP` · `SMS` · `EMAIL` · `VOZ` · `LLAMADA` |
| `motivo` | no | Para `CANCELADA` (máx. 300). Por defecto: "Cancelada por el tutor (contactabilidad)". |
| `id_externo` | recomendado | Id del evento en el motor (máx. 120). Hace la llamada **idempotente**. |

Transiciones permitidas: `RESERVADA → CONFIRMADA`, `RESERVADA | CONFIRMADA → CANCELADA`.

| Respuesta | Cuándo |
|---|---|
| `200 { cita }` | Aplicado. |
| `200 { cita, sin_cambios: true }` | La cita ya estaba en ese estado. |
| `200 { cita, duplicado: true }` | Ese `id_externo` ya se había procesado. |
| `404` | La cita no existe o es de otra organización. |
| `409` | Estado no permitido (p. ej. ya `LLEGO`, `ATENDIDA` o `CANCELADA` → `CONFIRMADA`), la hora ya pasó, se intenta cancelar una cita pagada en línea, o la cita cambió de estado durante la operación. |

Una respuesta tardía de "confirmar" sobre una cita ya liberada devuelve `409`: la cita **no** se reactiva, porque el turno pudo tomarlo otra persona. El motor debe ofrecer reagendar.

### 2.3 `POST /api/v1/citas/{id}/liberar` — liberar el cupo a la lista de espera

```json
{ "resultado": "SIN_RESPUESTA", "canal": "WHATSAPP", "id_externo": "lib-6f1c-1", "motivo": null }
```

`resultado`: `SIN_RESPUESTA` (por defecto) o `REAGENDA`.

Efecto, en una sola transacción:
1. La cita pasa a `CANCELADA` con motivo "Liberada: sin confirmación" (o "…el tutor pidió reagendar"). El turno queda **libre de inmediato** en la agenda.
2. El cupo (sucursal, profesional, fecha, hora, servicio) se registra en la **lista de espera** (`waitlist_slots`).

Solo se liberan citas `RESERVADA`, futuras y no pagadas en línea; si no, se responde `409`. Repetir la llamada sobre una cita ya liberada devuelve `200` con `duplicado: true` y el mismo cupo.

```json
200 {
  "cita": { "id": "6f1c…", "estado": "CANCELADA", … },
  "cupo": { "id": "…", "sucursal_id": "…", "profesional_id": "…", "servicio_id": "…", "especialidad_id": null,
            "fecha": "2026-10-22", "hora_inicio": "10:30", "hora_fin": "11:00", "liberado_at": "2026-10-21T22:00:03Z" }
}
```

### 2.4 `GET /api/v1/citas/{id}/disponibles` — horas libres para reagendar

Devuelve las horas libres en la **misma sucursal** y para el **mismo servicio** de la cita, con cualquier profesional que lo atienda. Si la cita no tiene servicio, se usa su especialidad, y si tampoco tiene, solo su mismo profesional. Solo para citas `RESERVADA` o `CONFIRMADA`, futuras y no pagadas (si no, `409`).

| Parámetro | Default | Descripción |
|---|---|---|
| `desde` | hoy | Nunca devuelve horas pasadas. |
| `hasta` | `desde` + 13 días | Rango máximo de 31 días. |

```json
200 {
  "cita": { "id": "6f1c…", "fecha": "2026-10-22", "hora_inicio": "10:30", … },
  "dias": [
    { "fecha": "2026-10-23", "turnos": [
      { "hora_inicio": "09:00", "hora_fin": "09:30", "profesional": { "id": "…", "nombre": "Ignacio Pérez" } }
    ] }
  ]
}
```

Solo se incluyen los días que tienen horas libres. La hora actual de la cita no aparece, porque está ocupada por ella misma.

### 2.5 `POST /api/v1/citas/{id}/reagendar` — cambiar la cita a otra hora

```json
{ "fecha": "2026-10-23", "hora_inicio": "09:00", "profesional_id": "…", "canal": "EMAIL", "id_externo": "reag-6f1c-1" }
```

`fecha`, `hora_inicio` y `profesional_id` son obligatorios y deben salir de una respuesta de §2.4. En una sola transacción:
1. La cita original pasa a `CANCELADA` con motivo "Reagendada por el tutor (contactabilidad)".
2. Se crea una cita nueva en la hora elegida, **`CONFIRMADA`** (la eligió el tutor), con los mismos datos de tutor, mascota, servicio y sucursal. Su campo interno `rescheduled_from` apunta a la original.

Si algo falla, no cambia nada: la cita original sigue igual.

| Respuesta | Cuándo |
|---|---|
| `201 { cita_anterior, cita_nueva }` | Reagendada. **Desde aquí el motor gestiona `cita_nueva.id`.** |
| `200 { …, duplicado: true }` | Esa cita ya se había reagendado o se repitió el `id_externo`: devuelve la misma cita nueva. |
| `400` | Datos inválidos, o el profesional no atiende el servicio. |
| `409` | La hora ya no está libre, la cita no es reagendable (estado, pagada o pasada) o cambió durante la operación. Volver a consultar §2.4. |

**Reagendar por correo.** El enlace "Reagendar" del correo abre una página del motor. Esa página:
1. lista las horas con §2.4;
2. al elegir una, llama a §2.5;
3. muestra la nueva hora confirmada.

Si el tutor no elige ninguna, el motor libera la cita con `/liberar` y `resultado: REAGENDA` (§2.3).

### 2.6 `GET /api/v1/estados` — matriz de estados

Devuelve en JSON la matriz de §3, para que el motor la valide en línea.

---

## 3. Matriz de mapeo de estados

El motor traduce sus códigos internos a estos **resultados**. Cada resultado tiene una única acción en el Core.

| Resultado del motor | Significado | Acción en el Core | Estado final de la cita |
|---|---|---|---|
| `CONFIRMA` | El tutor confirma | `POST /citas/{id}/estado` `CONFIRMADA` | `CONFIRMADA` |
| `CANCELA` | El tutor cancela | `POST /citas/{id}/estado` `CANCELADA` | `CANCELADA` (turno libre) |
| `REAGENDA` (elige hora) | El tutor elige otra hora | `GET /citas/{id}/disponibles` y luego `POST /citas/{id}/reagendar` | Original `CANCELADA`; cita nueva `CONFIRMADA` |
| `REAGENDA` (no elige) | El tutor pide otra hora pero no la toma | `POST /citas/{id}/liberar` | `CANCELADA` + cupo en lista de espera |
| `SIN_RESPUESTA` | Mensaje **entregado** y plazo de confirmación vencido | `POST /citas/{id}/liberar` | `CANCELADA` + cupo en lista de espera |
| `NO_CONTESTA` | Llamada sin respuesta, ocupado o buzón | ninguna (reintentar) | `RESERVADA` |
| `NO_ENTREGADO` | El mensaje no llegó | ninguna (probar otro canal o escalar) | `RESERVADA` |
| `NUMERO_INVALIDO` | Teléfono erróneo | ninguna (escalar a la sucursal) | `RESERVADA` |

**Estados del Core** que ve el motor:

| Estado Core | Significado | ¿Lo gestiona el motor? |
|---|---|---|
| `RESERVADA` | Agendada, pendiente de confirmar | Sí |
| `CONFIRMADA` | Confirmada | Solo para cancelar |
| `LLEGO` | En recepción | No |
| `ATENDIDA` | Atención cerrada | No |
| `NO_ASISTIO` | No se presentó | No |
| `CANCELADA` | Cancelada o liberada | No |

**Reglas para el motor:**
- **No liberar sin entrega confirmada.** `NO_ENTREGADO` y `NUMERO_INVALIDO` nunca deben llevar a `/liberar`: se escalan a la sucursal.
- **Citas pagadas** (`pago = "PAGADO"`): nunca se liberan ni se cancelan por la API, porque requieren devolución. Se escalan a la sucursal.
- **Reintentos:** enviar siempre `id_externo`. Ante un `5xx` o un *timeout*, reintentar con el **mismo** `id_externo`. Ante un `409`, no reintentar: volver a consultar la cita.

---

## 4. Errores comunes

Formato: `{ "error": "mensaje" }`. `400` datos inválidos · `401` token ausente, inválido o vencido · `403` sin acceso · `404` no encontrado · `409` conflicto de estado · `500` error interno (reintentable).

## 5. Pendiente para la puesta en marcha

- Aplicar la migración `0015_integracion_contactabilidad.sql`.
- Pantalla del portal para administrar credenciales (hoy solo existe la API).
- *Throttling* por ruta en API Gateway para `/api/v1/*`.
- Proceso de la lista de espera: ofrecer los cupos de `waitlist_slots` a los tutores en espera (R12 del documento de diseño).
