// Cálculo de turnos disponibles a partir de los bloques semanales
// (schedules) y las excepciones (schedule_exceptions). Funciones puras: no
// consultan la base, para poder reutilizarlas (p. ej. al reservar citas).
//
// Por fecha y por (profesional, sucursal):
//   1. Bloques semanales del día de la semana, activos y vigentes.
//   2. Si hay CAMBIO_HORARIO ese día, reemplaza a los bloques semanales.
//   3. Se suman los HORARIO_EXTRA.
//   4. Se quitan los turnos que tocan un BLOQUEO (del profesional, de la
//      sucursal o de toda la organización; sin horas = día completo).
// Fechas 'AAAA-MM-DD' y horas 'HH:MM[:SS]', como las entrega la base.

const aMinutos = (hora) => {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
};
const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const diaSemana = (fecha) => new Date(`${fecha}T00:00:00Z`).getUTCDay(); // 0 = domingo

function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const diasEntre = (desde, hasta) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000);

function fechas(desde, hasta) {
  const lista = [];
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) lista.push(f);
  return lista;
}

const cubre = (excepcion, fecha) => excepcion.start_date <= fecha && fecha <= excepcion.end_date;
const vigente = (bloque, fecha) =>
  (!bloque.valid_from || bloque.valid_from <= fecha) && (!bloque.valid_to || fecha <= bloque.valid_to);

// ¿Se cruzan dos vigencias [desde, hasta]? null = sin límite.
const vigenciasSeCruzan = (a, b) =>
  (!a.valid_from || !b.valid_to || a.valid_from <= b.valid_to) && (!b.valid_from || !a.valid_to || b.valid_from <= a.valid_to);

const clave = (staffId, branchId) => `${staffId}|${branchId}`;

// [{ staff_id, branch_id, intervalos: [{ inicio, fin, turno, origen }] }]
// en minutos, sin aplicar bloqueos.
function intervalosDelDia(bloques, excepciones, fecha) {
  const dia = diaSemana(fecha);
  const pares = new Map();
  const agregar = (staffId, branchId, intervalo) => {
    const k = clave(staffId, branchId);
    if (!pares.has(k)) pares.set(k, { staff_id: staffId, branch_id: branchId, intervalos: [] });
    pares.get(k).intervalos.push(intervalo);
  };
  const intervalo = (fila, origen) => ({
    inicio: aMinutos(fila.start_time),
    fin: aMinutos(fila.end_time),
    turno: fila.slot_duration_minutes,
    origen,
  });

  const delDia = excepciones.filter((e) => cubre(e, fecha));
  const cambios = delDia.filter((e) => e.type === 'CAMBIO_HORARIO');
  const conCambio = new Set(cambios.map((e) => clave(e.staff_id, e.branch_id)));

  for (const b of bloques) {
    if (b.is_active && b.day_of_week === dia && vigente(b, fecha) && !conCambio.has(clave(b.staff_id, b.branch_id))) {
      agregar(b.staff_id, b.branch_id, intervalo(b, 'SEMANAL'));
    }
  }
  for (const e of cambios) agregar(e.staff_id, e.branch_id, intervalo(e, 'CAMBIO'));
  for (const e of delDia) if (e.type === 'HORARIO_EXTRA') agregar(e.staff_id, e.branch_id, intervalo(e, 'EXTRA'));

  return [...pares.values()];
}

const bloqueosQueAplican = (excepciones, fecha, staffId, branchId) =>
  excepciones.filter(
    (e) =>
      e.type === 'BLOQUEO' &&
      cubre(e, fecha) &&
      (!e.staff_id || e.staff_id === staffId) &&
      (!e.branch_id || e.branch_id === branchId)
  );

const tocaBloqueo = (bloqueos, inicio, fin) =>
  bloqueos.some((x) => !x.start_time || (aMinutos(x.start_time) < fin && inicio < aMinutos(x.end_time)));

// [{ fecha, agendas: [{ staff_id, branch_id, turnos: [{ inicio, fin, origen }], bloqueos: [...] }] }]
// ocupados: citas vigentes [{ staff_id, date, start_time, end_time }]; sus
// turnos (del profesional, en cualquier sucursal) dejan de estar libres.
// desdeMinuto: en la fecha `desde`, descarta los turnos que empiezan antes
// (para no ofrecer horas que ya pasaron hoy).
function disponibilidad({ bloques, excepciones, desde, hasta, ocupados = [], desdeMinuto = 0 }) {
  return fechas(desde, hasta).map((fecha) => {
    const agendas = intervalosDelDia(bloques, excepciones, fecha).map(({ staff_id, branch_id, intervalos }) => {
      const bloqueos = bloqueosQueAplican(excepciones, fecha, staff_id, branch_id);
      const citas = ocupados
        .filter((c) => c.staff_id === staff_id && c.date === fecha)
        .map((c) => [aMinutos(c.start_time), aMinutos(c.end_time)]);
      const minimo = fecha === desde ? desdeMinuto : 0;
      const turnos = new Map();
      for (const i of intervalos) {
        for (let t = i.inicio; t + i.turno <= i.fin; t += i.turno) {
          const fin = t + i.turno;
          const tomado = citas.some(([a, b]) => a < fin && t < b);
          if (!turnos.has(t) && t >= minimo && !tomado && !tocaBloqueo(bloqueos, t, fin)) {
            turnos.set(t, { inicio: aHora(t), fin: aHora(t + i.turno), origen: i.origen });
          }
        }
      }
      return {
        staff_id,
        branch_id,
        turnos: [...turnos.entries()].sort(([a], [b]) => a - b).map(([, t]) => t),
        bloqueos: bloqueos.map(({ id, reason, start_time, end_time }) => ({ id, reason, start_time, end_time })),
      };
    });
    return { fecha, dia: diaSemana(fecha), agendas };
  });
}

// Primer cruce del profesional con sus intervalos en OTRAS sucursales entre
// desde y hasta (un horario extra o cambio no puede chocar con lo que ya
// atiende en otra sucursal). Devuelve { fecha, inicio, fin } o null.
function cruceEnOtraSucursal({ bloques, excepciones, staffId, branchId, desde, hasta, inicio, fin }) {
  for (const fecha of fechas(desde, hasta)) {
    for (const par of intervalosDelDia(bloques, excepciones, fecha)) {
      if (par.staff_id !== staffId || par.branch_id === branchId) continue;
      const c = par.intervalos.find((i) => i.inicio < fin && inicio < i.fin);
      if (c) return { fecha, inicio: aHora(c.inicio), fin: aHora(c.fin) };
    }
  }
  return null;
}

// Fecha y minuto del día en la zona horaria de la entidad (Lambda corre en
// UTC). ZONA_HORARIA por defecto: Chile continental.
function ahoraLocal(zona = process.env.ZONA_HORARIA || 'America/Santiago', ahora = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(ahora)
      .map((p) => [p.type, p.value])
  );
  return { fecha: `${partes.year}-${partes.month}-${partes.day}`, minuto: Number(partes.hour) * 60 + Number(partes.minute) };
}

module.exports = {
  ahoraLocal,
  aMinutos,
  aHora,
  diaSemana,
  sumarDias,
  diasEntre,
  vigenciasSeCruzan,
  intervalosDelDia,
  disponibilidad,
  cruceEnOtraSucursal,
};
