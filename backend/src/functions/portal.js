// Portal del tutor: lo usa el dueño de las mascotas (usuario con rol CLIENT,
// entra con Google). Sus datos (perfil y mascotas) son globales; al reservar
// en una organización se crea o reutiliza su ficha en ella (clients/pets),
// enlazada a su cuenta, y desde esas fichas sale su historial.
const crypto = require('crypto');
const { supabase, errorDb } = require('../lib/supabase');
const { requerirUsuario } = require('../lib/auth');
const { distanciaKm } = require('../lib/geo');
const { crearTransaccion } = require('../lib/webpay');
const d = require('../lib/disponibilidad');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');
const { profesionalesSegun, turnosLibres, liberarReservasVencidas } = require('./citas');
const { datosMascota } = require('./tutores');
const { urlRetorno } = require('./webpay');

const COLUMNAS_PERFIL = 'national_id, first_name, last_name, phone, address, city, region, latitude, longitude, updated_at';
const COLUMNAS_MASCOTA = 'id, name, species_id, breed_id, birth_date, weight, microchip_number, notes, created_at';
const COLUMNAS_SUCURSAL = 'id, organization_id, name, address, city, region, latitude, longitude, phone, email';

// Minutos que la reserva retiene el turno mientras se paga.
const MINUTOS_PAGO = 20;
const MAX_RESERVAS_PENDIENTES = 3;
const MAX_DIAS_PORTAL = 14;
const MAX_SUCURSALES = 30;

async function requerirTutor(event) {
  const usuario = await requerirUsuario(event);
  if (usuario.role !== 'CLIENT') throw new HttpError(403, 'Esta sección es para tutores de mascotas');
  return usuario;
}

// numeric llega como texto desde PostgREST.
const aNumero = (x) => (x == null ? null : Number(x));
const conCoordenadas = (fila) => ({ ...fila, latitude: aNumero(fila.latitude), longitude: aNumero(fila.longitude) });

// ── Perfil ───────────────────────────────────────────────────

async function leerPerfil(usuarioId) {
  const { data, error } = await supabase()
    .from('tutor_profiles')
    .select(COLUMNAS_PERFIL)
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  if (error) throw errorDb(error);
  return data ? conCoordenadas(data) : null;
}

function datosPerfil(body = {}) {
  const latitude = v.coordenada(body.latitude, 'Latitud', 90, { requerido: false });
  const longitude = v.coordenada(body.longitude, 'Longitud', 180, { requerido: false });
  if ((latitude == null) !== (longitude == null)) throw new HttpError(400, 'Indica latitud y longitud, o ninguna');
  return {
    national_id: v.rut(body.national_id, 'RUT'),
    first_name: v.texto(body.first_name, 'Nombres', { requerido: true, max: 80 }),
    last_name: v.texto(body.last_name, 'Apellidos', { requerido: true, max: 80 }),
    phone: v.texto(body.phone, 'Teléfono', { max: 40 }),
    address: v.texto(body.address, 'Dirección'),
    city: v.texto(body.city, 'Comuna / ciudad', { max: 120 }),
    region: v.texto(body.region, 'Región', { max: 120 }),
    latitude,
    longitude,
  };
}

// GET /portal/perfil  -> { perfil, email, avatar_url }
// Sin perfil guardado, propone nombres a partir del nombre de la cuenta de Google.
module.exports.obtenerPerfil = handler(async (event) => {
  const usuario = await requerirTutor(event);
  const { data: cuenta, error } = await supabase()
    .from('usuarios')
    .select('email, full_name, avatar_url, phone')
    .eq('id', usuario.id)
    .single();
  if (error) throw errorDb(error);

  let perfil = await leerPerfil(usuario.id);
  const completo = !!(perfil?.first_name && perfil?.last_name);
  if (!perfil) {
    const [nombre, ...apellidos] = (cuenta.full_name || '').trim().split(/\s+/);
    perfil = { first_name: nombre || '', last_name: apellidos.join(' '), phone: cuenta.phone };
  }
  return json(200, { perfil, completo, email: cuenta.email, avatar_url: cuenta.avatar_url });
});

// PUT /portal/perfil  { national_id?, first_name, last_name, phone?, address?, city?, region?, latitude?, longitude? }
module.exports.guardarPerfil = handler(async (event) => {
  const usuario = await requerirTutor(event);
  const datos = datosPerfil(parseJson(event));

  const { error } = await supabase()
    .from('tutor_profiles')
    .upsert({ ...datos, usuario_id: usuario.id, updated_at: new Date().toISOString() }, { onConflict: 'usuario_id' });
  if (error?.code === '23505') throw new HttpError(409, 'Ese RUT ya está registrado en otra cuenta');
  if (error) throw errorDb(error);

  // El nombre y el teléfono de la cuenta siguen al perfil (se muestran en la barra).
  const { error: errorCuenta } = await supabase()
    .from('usuarios')
    .update({ full_name: `${datos.first_name} ${datos.last_name}`, phone: datos.phone })
    .eq('id', usuario.id);
  if (errorCuenta) throw errorDb(errorCuenta);

  return json(200, { perfil: await leerPerfil(usuario.id), completo: true });
});

// ── Mascotas ─────────────────────────────────────────────────

// GET /portal/especies  -> catálogo base (el que comparten todas las organizaciones)
module.exports.especies = handler(async (event) => {
  await requerirTutor(event);
  const { data, error } = await supabase()
    .from('species')
    .select('id, name, breeds(id, name, organization_id)')
    .is('organization_id', null)
    .order('name');
  if (error) throw errorDb(error);
  const especies = data.map((e) => ({
    id: e.id,
    name: e.name,
    razas: e.breeds
      .filter((r) => r.organization_id === null)
      .map((r) => ({ id: r.id, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  }));
  return json(200, { especies });
});

async function validarCatalogoBase(mascota) {
  const { data: especie, error } = await supabase()
    .from('species')
    .select('id')
    .eq('id', mascota.species_id)
    .is('organization_id', null)
    .maybeSingle();
  if (error) throw errorDb(error);
  if (!especie) throw new HttpError(400, 'Especie no válida');
  if (mascota.breed_id) {
    const { data: raza, error: errorRaza } = await supabase()
      .from('breeds')
      .select('id')
      .eq('id', mascota.breed_id)
      .eq('species_id', mascota.species_id)
      .is('organization_id', null)
      .maybeSingle();
    if (errorRaza) throw errorDb(errorRaza);
    if (!raza) throw new HttpError(400, 'La raza no corresponde a la especie');
  }
}

function errorMascota(error) {
  if (error.code === '23505' && /microchip/.test(error.message)) {
    return new HttpError(409, 'Ese número de microchip ya está registrado');
  }
  return errorDb(error);
}

const numericos = (m) => ({ ...m, weight: aNumero(m.weight) });

async function miMascota(usuarioId, id) {
  const { data, error } = await supabase()
    .from('tutor_pets')
    .select(COLUMNAS_MASCOTA)
    .eq('id', id)
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  if (error) throw errorDb(error);
  if (!data) throw new HttpError(404, 'Mascota no encontrada');
  return numericos(data);
}

// GET /portal/mascotas
module.exports.listarMascotas = handler(async (event) => {
  const usuario = await requerirTutor(event);
  const { data, error } = await supabase()
    .from('tutor_pets')
    .select(COLUMNAS_MASCOTA)
    .eq('usuario_id', usuario.id)
    .order('name');
  if (error) throw errorDb(error);
  return json(200, { mascotas: data.map(numericos) });
});

// POST /portal/mascotas
module.exports.crearMascota = handler(async (event) => {
  const usuario = await requerirTutor(event);
  const mascota = datosMascota(parseJson(event));
  await validarCatalogoBase(mascota);

  const { count, error: errorConteo } = await supabase()
    .from('tutor_pets')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_id', usuario.id);
  if (errorConteo) throw errorDb(errorConteo);
  if (count >= 30) throw new HttpError(400, 'Máximo 30 mascotas por cuenta');

  const { data, error } = await supabase()
    .from('tutor_pets')
    .insert({ ...mascota, usuario_id: usuario.id })
    .select(COLUMNAS_MASCOTA)
    .single();
  if (error) throw errorMascota(error);
  return json(201, { mascota: numericos(data) });
});

// PUT /portal/mascotas/{id}
// Los datos básicos se copian a las fichas enlazadas de las organizaciones
// (las notas no: en la ficha son de la organización).
module.exports.actualizarMascota = handler(async (event) => {
  const usuario = await requerirTutor(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await miMascota(usuario.id, id);
  const mascota = datosMascota(parseJson(event));
  await validarCatalogoBase(mascota);

  const { error } = await supabase()
    .from('tutor_pets')
    .update({ ...mascota, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw errorMascota(error);

  const { name, species_id, breed_id, birth_date, weight } = mascota;
  const { error: errorFichas } = await supabase()
    .from('pets')
    .update({ name, species_id, breed_id, birth_date, weight })
    .eq('tutor_pet_id', id);
  if (errorFichas) console.error('No se pudieron actualizar las fichas enlazadas', errorFichas);

  return json(200, { mascota: await miMascota(usuario.id, id) });
});

// DELETE /portal/mascotas/{id}  (las fichas de las organizaciones y su historial se conservan)
module.exports.eliminarMascota = handler(async (event) => {
  const usuario = await requerirTutor(event);
  const id = v.uuid(event.pathParameters.id, 'id');
  await miMascota(usuario.id, id);
  const { error } = await supabase().from('tutor_pets').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, { ok: true });
});

// ── Sucursales ───────────────────────────────────────────────

// GET /portal/sucursales?lat=&lng=&q=
// Sucursales activas con ubicación, de todas las organizaciones, de la más
// cercana a la más lejana. Sin lat/lng se usa la dirección del perfil.
module.exports.sucursales = handler(async (event) => {
  const usuario = await requerirTutor(event);
  const q = event.queryStringParameters || {};

  let punto = null;
  if (q.lat != null || q.lng != null) {
    punto = { latitude: v.coordenada(q.lat, 'lat', 90), longitude: v.coordenada(q.lng, 'lng', 180) };
  } else {
    const perfil = await leerPerfil(usuario.id);
    if (perfil?.latitude != null) punto = { latitude: perfil.latitude, longitude: perfil.longitude };
  }

  const { data, error } = await supabase()
    .from('branches')
    .select(`${COLUMNAS_SUCURSAL}, organization:organizations(id, name, type)`)
    .eq('is_active', true)
    .not('latitude', 'is', null);
  if (error) throw errorDb(error);

  const normalizar = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const texto = normalizar(v.texto(q.q, 'Búsqueda', { max: 80 }));
  let sucursales = data.map(conCoordenadas);
  if (texto) {
    sucursales = sucursales.filter((s) =>
      [s.name, s.address, s.city, s.region, s.organization?.name].some((x) => normalizar(x).includes(texto))
    );
  }
  if (punto) {
    sucursales = sucursales
      .map((s) => ({ ...s, distancia_km: Number(distanciaKm(punto, s).toFixed(2)) }))
      .sort((a, b) => a.distancia_km - b.distancia_km);
  } else {
    sucursales.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }
  return json(200, { punto, sucursales: sucursales.slice(0, MAX_SUCURSALES) });
});

async function sucursalActiva(id) {
  const { data, error } = await supabase()
    .from('branches')
    .select(`${COLUMNAS_SUCURSAL}, organization:organizations(id, name)`)
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw errorDb(error);
  if (!data) throw new HttpError(404, 'Sucursal no encontrada');
  return conCoordenadas(data);
}

async function servicioActivo(id, orgId) {
  const { data, error } = await supabase()
    .from('services_catalog')
    .select('id, name, category, description, price, duration_minutes')
    .eq('id', id)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw errorDb(error);
  if (!data) throw new HttpError(404, 'Servicio no encontrado');
  return { ...data, price: Number(data.price) };
}

// GET /portal/sucursales/{id}  -> { sucursal, servicios }
module.exports.sucursal = handler(async (event) => {
  await requerirTutor(event);
  const sucursal = await sucursalActiva(v.uuid(event.pathParameters.id, 'id'));
  const { data, error } = await supabase()
    .from('services_catalog')
    .select('id, name, category, description, price, duration_minutes')
    .eq('organization_id', sucursal.organization_id)
    .eq('is_active', true)
    .order('category')
    .order('name');
  if (error) throw errorDb(error);
  return json(200, { sucursal, servicios: data.map((s) => ({ ...s, price: Number(s.price) })) });
});

// GET /portal/disponibles?branchId=&serviceId=&desde=&hasta=
// -> { dias: [{ fecha, agendas: [{ staff_id, turnos }] }], profesionales: { id: nombre } }
module.exports.disponibles = handler(async (event) => {
  await requerirTutor(event);
  const q = event.queryStringParameters || {};
  const sucursal = await sucursalActiva(v.uuid(q.branchId, 'Sucursal'));
  const org = sucursal.organization_id;
  const servicio = await servicioActivo(v.uuid(q.serviceId, 'Servicio'), org);

  const hoy = d.ahoraLocal().fecha;
  const desde = v.fecha(q.desde, 'desde') || hoy;
  const hasta = v.fecha(q.hasta, 'hasta') || d.sumarDias(desde, 6);
  if (hasta < desde) throw new HttpError(400, 'El rango de fechas está invertido');
  if (d.diasEntre(desde, hasta) >= MAX_DIAS_PORTAL) throw new HttpError(400, `Busca como máximo ${MAX_DIAS_PORTAL} días`);

  const staffIds = await profesionalesSegun(org, { serviceId: servicio.id });
  const dias = await turnosLibres(org, { desde, hasta, staffIds, branchId: sucursal.id });

  const ids = [...new Set(dias.flatMap((dia) => dia.agendas.map((a) => a.staff_id)))];
  let profesionales = {};
  if (ids.length) {
    const { data, error } = await supabase().from('usuarios').select('id, full_name').in('id', ids);
    if (error) throw errorDb(error);
    profesionales = Object.fromEntries(data.map((p) => [p.id, p.full_name || 'Profesional']));
  }
  return json(200, {
    dias: dias.map((dia) => ({
      fecha: dia.fecha,
      dia: dia.dia,
      agendas: dia.agendas.map((a) => ({ staff_id: a.staff_id, turnos: a.turnos.map(({ inicio, fin }) => ({ inicio, fin })) })),
    })),
    profesionales,
  });
});

// ── Fichas en la organización ────────────────────────────────

// Ficha (clients) del tutor en la organización: la enlazada a su cuenta; si
// no hay, una ficha sin enlazar con su mismo email (verificado por Google);
// si tampoco, una nueva con los datos del perfil.
async function fichaTutor(orgId, usuario, perfil) {
  const db = supabase();
  const { data: enlazada, error } = await db
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('usuario_id', usuario.id)
    .maybeSingle();
  if (error) throw errorDb(error);
  if (enlazada) return enlazada.id;

  const { data: porEmail, error: errorEmail } = await db
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .is('usuario_id', null)
    .eq('email', usuario.email)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (errorEmail) throw errorDb(errorEmail);
  if (porEmail) {
    const { error: e } = await db.from('clients').update({ usuario_id: usuario.id }).eq('id', porEmail.id);
    if (e) throw errorDb(e);
    return porEmail.id;
  }

  const ficha = {
    organization_id: orgId,
    usuario_id: usuario.id,
    national_id: perfil.national_id,
    first_name: perfil.first_name,
    last_name: perfil.last_name,
    phone: perfil.phone,
    email: usuario.email,
    address: [perfil.address, perfil.city].filter(Boolean).join(', ') || null,
  };
  let { data, error: errorAlta } = await db.from('clients').insert(ficha).select('id').single();
  // Ya hay una ficha con ese RUT (ingresada por la recepción): se crea sin RUT
  // y la organización decide si las une.
  if (errorAlta?.code === '23505' && /national_id/.test(errorAlta.message)) {
    ({ data, error: errorAlta } = await db.from('clients').insert({ ...ficha, national_id: null }).select('id').single());
  }
  if (errorAlta) throw errorDb(errorAlta);
  return data.id;
}

// Ficha (pets) de la mascota en la organización, enlazada a la del tutor.
async function fichaMascota(orgId, clientId, mascota) {
  const db = supabase();
  const { data: enlazada, error } = await db
    .from('pets')
    .select('id, client_id')
    .eq('organization_id', orgId)
    .eq('tutor_pet_id', mascota.id)
    .maybeSingle();
  if (error) throw errorDb(error);
  if (enlazada?.client_id === clientId) return enlazada.id;
  if (enlazada) throw new HttpError(409, 'Esa mascota figura con otro tutor en esta organización. Contacta a la sucursal.');

  // Mascota del mismo tutor ya registrada por la recepción (mismo nombre y especie).
  const { data: candidatas, error: errorCand } = await db
    .from('pets')
    .select('id, name')
    .eq('client_id', clientId)
    .eq('species_id', mascota.species_id)
    .is('tutor_pet_id', null);
  if (errorCand) throw errorDb(errorCand);
  const misma = candidatas.find((p) => p.name.trim().toLowerCase() === mascota.name.trim().toLowerCase());
  if (misma) {
    const { error: e } = await db.from('pets').update({ tutor_pet_id: mascota.id }).eq('id', misma.id);
    if (e) throw errorDb(e);
    return misma.id;
  }

  const ficha = {
    organization_id: orgId,
    client_id: clientId,
    tutor_pet_id: mascota.id,
    name: mascota.name,
    species_id: mascota.species_id,
    breed_id: mascota.breed_id,
    birth_date: mascota.birth_date,
    weight: mascota.weight,
    microchip_number: mascota.microchip_number,
    notes: mascota.notes,
  };
  let { data, error: errorAlta } = await db.from('pets').insert(ficha).select('id').single();
  if (errorAlta?.code === '23505' && /microchip/.test(errorAlta.message)) {
    ({ data, error: errorAlta } = await db.from('pets').insert({ ...ficha, microchip_number: null }).select('id').single());
  }
  if (errorAlta) throw errorDb(errorAlta);
  return data.id;
}

// Ids de las fichas del tutor en todas las organizaciones.
async function misFichas(usuarioId) {
  const { data, error } = await supabase().from('clients').select('id').eq('usuario_id', usuarioId);
  if (error) throw errorDb(error);
  return data.map((c) => c.id);
}

// ── Citas ────────────────────────────────────────────────────

const COLUMNAS_CITA =
  'id, organization_id, branch_id, date, start_time, end_time, status, cancel_reason, notes, created_at, ' +
  'payment_status, payment_amount, payment_expires_at, ' +
  'branch:branches(name, address, city, phone), organization:organizations(name), ' +
  'service:services_catalog(name, category), pet:pets!appointments_pet_id_fkey(name, tutor_pet_id), ' +
  'staff:usuarios!appointments_staff_id_fkey(full_name)';

const citaPublica = (c) => ({ ...c, payment_amount: aNumero(c.payment_amount) });

async function miCita(usuarioId, id) {
  const fichas = await misFichas(usuarioId);
  if (!fichas.length) throw new HttpError(404, 'Cita no encontrada');
  const { data, error } = await supabase()
    .from('appointments')
    .select(COLUMNAS_CITA)
    .eq('id', id)
    .in('client_id', fichas)
    .maybeSingle();
  if (error) throw errorDb(error);
  if (!data) throw new HttpError(404, 'Cita no encontrada');
  return citaPublica(data);
}

// Crea la transacción Webpay de la cita y extiende la retención del turno.
// -> { url, token }: el frontend envía un form POST a url con token_ws = token.
async function iniciarPago(cita, usuario, event) {
  const amount = Math.round(cita.payment_amount);
  // buy_order: máximo 26 caracteres
  const buyOrder = `PA${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
  const tx = await crearTransaccion({ buyOrder, sessionId: usuario.id, amount, returnUrl: urlRetorno(event) });

  const { error } = await supabase().from('online_payments').insert({
    organization_id: cita.organization_id,
    appointment_id: cita.id,
    usuario_id: usuario.id,
    buy_order: buyOrder,
    token: tx.token,
    amount,
  });
  if (error) throw errorDb(error);

  const { error: errorCita } = await supabase()
    .from('appointments')
    .update({ payment_expires_at: new Date(Date.now() + MINUTOS_PAGO * 60_000).toISOString() })
    .eq('id', cita.id)
    .eq('payment_status', 'PENDIENTE');
  if (errorCita) throw errorDb(errorCita);
  return { url: tx.url, token: tx.token };
}

// GET /portal/citas  -> todas las citas del tutor (en todas las organizaciones)
module.exports.listarCitas = handler(async (event) => {
  const usuario = await requerirTutor(event);
  const fichas = await misFichas(usuario.id);
  if (!fichas.length) return json(200, { citas: [] });
  await liberarReservasVencidas();
  const { data, error } = await supabase()
    .from('appointments')
    .select(COLUMNAS_CITA)
    .in('client_id', fichas)
    .order('date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(200);
  if (error) throw errorDb(error);
  return json(200, { citas: data.map(citaPublica) });
});

// POST /portal/citas  { branch_id, service_id, staff_id, date, start_time, tutor_pet_id, notes? }
// -> { cita, pago? }  Con precio, la cita queda con el pago PENDIENTE y
// retiene el turno MINUTOS_PAGO minutos; `pago` lleva a Webpay.
module.exports.reservar = handler(async (event) => {
  const usuario = await requerirTutor(event);
  const body = parseJson(event);
  const perfil = await leerPerfil(usuario.id);
  if (!perfil?.first_name || !perfil?.last_name) {
    throw new HttpError(400, 'Completa tu perfil (nombres y apellidos) antes de reservar');
  }

  const sucursal = await sucursalActiva(v.uuid(body.branch_id, 'Sucursal'));
  const org = sucursal.organization_id;
  const servicio = await servicioActivo(v.uuid(body.service_id, 'Servicio'), org);
  const mascota = await miMascota(usuario.id, v.uuid(body.tutor_pet_id, 'Mascota'));
  const staffId = v.uuid(body.staff_id, 'Profesional');
  const fecha = v.fecha(body.date, 'Fecha');
  if (!fecha) throw new HttpError(400, 'Fecha: es obligatoria');
  const inicio = v.hora(body.start_time, 'Hora');
  if (fecha < d.ahoraLocal().fecha) throw new HttpError(400, 'No se puede reservar en una fecha pasada');

  await liberarReservasVencidas();
  const { count, error: errorConteo } = await supabase()
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', usuario.id)
    .eq('payment_status', 'PENDIENTE');
  if (errorConteo) throw errorDb(errorConteo);
  if (count >= MAX_RESERVAS_PENDIENTES) {
    throw new HttpError(429, 'Tienes reservas con el pago pendiente: págalas o cancélalas en "Mis citas" antes de reservar otra');
  }

  // El profesional debe ofrecer el servicio y el turno estar libre ahora mismo.
  const staffIds = await profesionalesSegun(org, { serviceId: servicio.id });
  if (!staffIds.includes(staffId)) throw new HttpError(400, 'Ese profesional no ofrece el servicio elegido');
  const dias = await turnosLibres(org, { desde: fecha, hasta: fecha, staffIds: [staffId], branchId: sucursal.id });
  const turno = dias[0]?.agendas.find((a) => a.staff_id === staffId)?.turnos.find((t) => t.inicio === inicio);
  if (!turno) throw new HttpError(409, 'Ese horario ya no está disponible. Elige otro.');

  const clientId = await fichaTutor(org, usuario, perfil);
  const petId = await fichaMascota(org, clientId, mascota);
  const conPago = servicio.price > 0;

  const { data, error } = await supabase()
    .from('appointments')
    .insert({
      organization_id: org,
      branch_id: sucursal.id,
      staff_id: staffId,
      date: fecha,
      start_time: turno.inicio,
      end_time: turno.fin,
      service_id: servicio.id,
      client_id: clientId,
      pet_id: petId,
      contact_name: `${perfil.first_name} ${perfil.last_name}`,
      contact_phone: perfil.phone,
      contact_email: usuario.email,
      notes: v.texto(body.notes, 'Comentarios', { max: 1000 }),
      created_by: usuario.id,
      payment_status: conPago ? 'PENDIENTE' : null,
      payment_amount: servicio.price,
      payment_expires_at: conPago ? new Date(Date.now() + MINUTOS_PAGO * 60_000).toISOString() : null,
    })
    .select('id')
    .single();
  if (error?.code === '23505') throw new HttpError(409, 'Ese horario acaba de ser reservado por otra persona. Elige otro.');
  if (error) throw errorDb(error);

  const cita = await miCita(usuario.id, data.id);
  if (!conPago) return json(201, { cita });

  try {
    return json(201, { cita, pago: await iniciarPago(cita, usuario, event) });
  } catch (err) {
    // Sin pago no se retiene el turno.
    console.error('No se pudo iniciar el pago de la reserva', err);
    await supabase()
      .from('appointments')
      .update({ status: 'CANCELADA', cancel_reason: 'No se pudo iniciar el pago', payment_status: null, updated_at: new Date().toISOString() })
      .eq('id', cita.id);
    throw new HttpError(502, 'No pudimos conectar con Webpay. La reserva no se realizó; intenta de nuevo.');
  }
});

// POST /portal/citas/{id}/pago  -> { pago }  reintenta el pago de una reserva pendiente
module.exports.pagarCita = handler(async (event) => {
  const usuario = await requerirTutor(event);
  await liberarReservasVencidas();
  const cita = await miCita(usuario.id, v.uuid(event.pathParameters.id, 'id'));
  if (cita.payment_status !== 'PENDIENTE' || cita.status === 'CANCELADA') {
    throw new HttpError(409, 'Esta cita no tiene un pago pendiente');
  }
  try {
    return json(201, { pago: await iniciarPago(cita, usuario, event) });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('No se pudo iniciar el pago', err);
    throw new HttpError(502, 'No pudimos conectar con Webpay. Intenta de nuevo.');
  }
});

// POST /portal/citas/{id}/cancelar
// Las pagadas no se anulan desde aquí: la devolución la gestiona la sucursal.
module.exports.cancelarCita = handler(async (event) => {
  const usuario = await requerirTutor(event);
  const cita = await miCita(usuario.id, v.uuid(event.pathParameters.id, 'id'));
  if (!['RESERVADA', 'CONFIRMADA'].includes(cita.status)) throw new HttpError(409, 'Esta cita ya no se puede cancelar');
  if (cita.date < d.ahoraLocal().fecha) throw new HttpError(409, 'La fecha de la cita ya pasó');
  if (cita.payment_status === 'PAGADO') {
    throw new HttpError(409, 'Esta cita ya está pagada: para anularla y pedir la devolución contacta a la sucursal');
  }

  const { error } = await supabase()
    .from('appointments')
    .update({ status: 'CANCELADA', cancel_reason: 'Cancelada por el tutor', payment_status: null, updated_at: new Date().toISOString() })
    .eq('id', cita.id)
    .in('status', ['RESERVADA', 'CONFIRMADA']);
  if (error) throw errorDb(error);
  await supabase().from('online_payments').update({ status: 'ANULADO' }).eq('appointment_id', cita.id).eq('status', 'PENDIENTE');
  return json(200, { cita: await miCita(usuario.id, cita.id) });
});

// ── Historial de atenciones ──────────────────────────────────

// GET /portal/historial?tutorPetId=  -> atenciones (no anuladas) en todas las organizaciones
module.exports.historial = handler(async (event) => {
  const usuario = await requerirTutor(event);
  const q = event.queryStringParameters || {};
  const fichas = await misFichas(usuario.id);
  if (!fichas.length) return json(200, { atenciones: [] });

  const { data, error } = await supabase()
    .from('visits')
    .select(
      'id, date, arrived_at, closed_at, status, observations, pet_name, ' +
        'branch:branches(name, city), organization:organizations(name), ' +
        'pet:pets!visits_pet_id_fkey(name, tutor_pet_id), staff:usuarios!visits_staff_id_fkey(full_name), ' +
        'specialty:specialties(name), items:visit_items(description, quantity, unit_price), ' +
        'payments:visit_payments(method, amount, date)'
    )
    .in('client_id', fichas)
    .neq('status', 'ANULADA')
    .order('date', { ascending: false })
    .order('arrived_at', { ascending: false })
    .limit(200);
  if (error) throw errorDb(error);

  const tutorPetId = q.tutorPetId && v.uuid(q.tutorPetId, 'tutorPetId');
  const atenciones = data
    .filter((a) => !tutorPetId || a.pet?.tutor_pet_id === tutorPetId)
    .map((a) => {
      const items = a.items.map((i) => ({ ...i, unit_price: Number(i.unit_price) }));
      const payments = a.payments.map((p) => ({ ...p, amount: Number(p.amount) }));
      const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      const pagado = payments.reduce((s, p) => s + p.amount, 0);
      return { ...a, pet_name: a.pet?.name || a.pet_name, items, payments, total, pagado, saldo: Math.max(total - pagado, 0) };
    });
  return json(200, { atenciones });
});
