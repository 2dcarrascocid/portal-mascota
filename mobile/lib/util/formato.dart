import 'package:intl/intl.dart';

// Mismos textos que frontend/src/lib/catalogos.js
const estadosCita = {
  'RESERVADA': 'Reservada',
  'CONFIRMADA': 'Confirmada',
  'LLEGO': 'Llegó',
  'ATENDIDA': 'Atendida',
  'NO_ASISTIO': 'No asistió',
  'CANCELADA': 'Cancelada',
};

// Fechas 'AAAA-MM-DD' en hora local.
String hoy() => DateFormat('yyyy-MM-dd').format(DateTime.now());

// "lun 12 oct" / con año: "12 oct 2026"
String fechaCorta(String? texto, {bool anio = false}) {
  if (texto == null || texto.isEmpty) return '';
  return DateFormat(anio ? 'd MMM y' : 'EEE d MMM', 'es').format(DateTime.parse(texto));
}

String hhmm(String? hora) => hora == null || hora.length < 5 ? (hora ?? '') : hora.substring(0, 5);

final _clp = NumberFormat.currency(locale: 'es_CL', symbol: r'$', decimalDigits: 0);

// $12.990 (el backend puede mandar el monto como número o texto)
String pesos(Object? monto) => _clp.format(num.tryParse('${monto ?? 0}') ?? 0);

String edad(String? nacimiento) {
  if (nacimiento == null || nacimiento.isEmpty) return '';
  final dias = DateTime.now().difference(DateTime.parse(nacimiento)).inDays;
  final meses = (dias / 30.44).floor();
  if (meses < 1) return 'menos de 1 mes';
  if (meses < 12) return '$meses ${meses == 1 ? 'mes' : 'meses'}';
  final anios = meses ~/ 12;
  return '$anios ${anios == 1 ? 'año' : 'años'}';
}

// Cita futura que todavía no se cierra.
bool citaVigente(Map c) =>
    (c['date'] as String).compareTo(hoy()) >= 0 && const ['RESERVADA', 'CONFIRMADA', 'LLEGO'].contains(c['status']);

int porFechaHora(Map a, Map b) => '${a['date']}${a['start_time']}'.compareTo('${b['date']}${b['start_time']}');
