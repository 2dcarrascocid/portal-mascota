// Módulo Pagos y caja: resumen de los pagos del día por sucursal
// (cuadratura por medio de pago y pendientes) y cierre diario de caja.
// Los pagos se registran en las atenciones (POST /atenciones/{id}/pagos);
// aquí se consultan y se cierra el día. El resumen y el cierre los calcula
// la base (RPC cash_day_summary / close_cash_day) para que coincidan.
// Con la caja cerrada la base rechaza agregar o quitar pagos de ese día.
const { supabase, errorDb } = require('../lib/supabase');
const { requerirPermiso, sucursalesDe, requerirSucursal, deLaOrganizacion } = require('../lib/acceso');
const { ahoraLocal } = require('../lib/disponibilidad');
const v = require('../lib/validar');
const { HttpError, json, parseJson, handler } = require('../lib/http');

const COLUMNAS_PAGO =
  'id, visit_id, method, amount, reference, created_at, registrado:usuarios(full_name), ' +
  'visit:visits(id, date, status, contact_name, pet_name, pet:pets!visits_pet_id_fkey(name))';

const COLUMNAS_CIERRE =
  'id, branch_id, date, opening_cash, cash_expected, cash_counted, card_expected, card_counted, ' +
  'online_expected, online_counted, other_expected, other_counted, total_collected, payments_count, ' +
  'pending_count, pending_amount, summary, notes, closed_at, cerrado_por:usuarios(full_name)';

const redondear = (n) => (n == null ? null : Math.round(n * 100) / 100);

// Sucursal de la organización y del usuario.
async function sucursalPermitida(usuario, branchId) {
  await requerirSucursal(usuario, branchId);
  await deLaOrganizacion('branches', branchId, usuario);
}

async function cierreDe(branchId, fecha) {
  const { data, error } = await supabase()
    .from('cash_closures')
    .select(COLUMNAS_CIERRE)
    .eq('branch_id', branchId)
    .eq('date', fecha)
    .maybeSingle();
  if (error) throw errorDb(error);
  return data;
}

// Resumen, pagos y cierre de una caja (sucursal + día). Cerrada, el resumen
// es la foto tomada al cerrar.
async function caja(usuario, branchId, fecha) {
  const org = usuario.organization_id;
  const [resumen, pagos, cierre] = await Promise.all([
    supabase().rpc('cash_day_summary', { p_organization_id: org, p_branch_id: branchId, p_date: fecha }),
    supabase()
      .from('visit_payments')
      .select(COLUMNAS_PAGO)
      .eq('organization_id', org)
      .eq('branch_id', branchId)
      .eq('date', fecha)
      .order('created_at')
      .limit(2000),
    cierreDe(branchId, fecha),
  ]);
  if (resumen.error) throw errorDb(resumen.error);
  if (pagos.error) throw errorDb(pagos.error);
  return {
    fecha,
    hoy: ahoraLocal().fecha,
    branch_id: branchId,
    resumen: cierre ? cierre.summary : resumen.data,
    pagos: pagos.data,
    cierre,
  };
}

// GET /caja?branchId=&fecha=  -> { fecha, hoy, branch_id, resumen, pagos, cierre }
module.exports.resumen = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'caja.ver');
  const q = event.queryStringParameters || {};
  const fecha = v.fecha(q.fecha, 'fecha') || ahoraLocal().fecha;
  const branchId = v.uuid(q.branchId, 'Sucursal');
  await sucursalPermitida(usuario, branchId);
  return json(200, await caja(usuario, branchId, fecha));
});

// GET /caja/cierres?branchId=&desde=&hasta=  -> historial de cierres (más recientes primero)
module.exports.listarCierres = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'caja.ver');
  const q = event.queryStringParameters || {};
  const branchId = v.uuid(q.branchId, 'Sucursal', { requerido: false });
  const desde = v.fecha(q.desde, 'desde');
  const hasta = v.fecha(q.hasta, 'hasta');
  const permitidas = await sucursalesDe(usuario);
  if (permitidas && !permitidas.length) return json(200, { cierres: [] });

  let consulta = supabase()
    .from('cash_closures')
    .select(COLUMNAS_CIERRE)
    .eq('organization_id', usuario.organization_id)
    .order('date', { ascending: false })
    .limit(200);
  if (branchId) consulta = consulta.eq('branch_id', branchId);
  if (permitidas) consulta = consulta.in('branch_id', permitidas);
  if (desde) consulta = consulta.gte('date', desde);
  if (hasta) consulta = consulta.lte('date', hasta);
  const { data, error } = await consulta;
  if (error) throw errorDb(error);
  return json(200, { cierres: data });
});

// POST /caja/cierres  { branch_id, date, opening_cash?, cash_counted?, card_counted?,
//                       online_counted?, other_counted?, notes? }
// Cierra la caja del día (hoy o un día anterior aún abierto) con el arqueo.
module.exports.cerrar = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'caja.crear');
  const body = parseJson(event);
  const branchId = v.uuid(body.branch_id, 'Sucursal');
  const fecha = v.fecha(body.date, 'Fecha') || ahoraLocal().fecha;
  if (fecha > ahoraLocal().fecha) throw new HttpError(400, 'No se puede cerrar la caja de un día futuro');
  await sucursalPermitida(usuario, branchId);

  const contado = (campo, nombre) => redondear(v.numero(body[campo], nombre));
  const { error } = await supabase().rpc('close_cash_day', {
    p_organization_id: usuario.organization_id,
    p_branch_id: branchId,
    p_date: fecha,
    p_user_id: usuario.id,
    p_opening_cash: contado('opening_cash', 'Fondo inicial') ?? 0,
    p_cash_counted: contado('cash_counted', 'Efectivo contado'),
    p_card_counted: contado('card_counted', 'Tarjetas'),
    p_online_counted: contado('online_counted', 'Internet'),
    p_other_counted: contado('other_counted', 'Otros medios'),
    p_notes: v.texto(body.notes, 'Observaciones', { max: 1000 }),
  });
  if (error) throw errorDb(error);
  return json(201, await caja(usuario, branchId, fecha));
});

// DELETE /caja/cierres/{id}  -> reabre la caja (vuelve a admitir pagos de ese día)
module.exports.reabrir = handler(async (event) => {
  const usuario = await requerirPermiso(event, 'caja.eliminar');
  const id = v.uuid(event.pathParameters.id, 'id');
  const cierre = await deLaOrganizacion('cash_closures', id, usuario, 'id, branch_id, date');
  await requerirSucursal(usuario, cierre.branch_id);
  const { error } = await supabase().from('cash_closures').delete().eq('id', id);
  if (error) throw errorDb(error);
  return json(200, await caja(usuario, cierre.branch_id, cierre.date));
});
