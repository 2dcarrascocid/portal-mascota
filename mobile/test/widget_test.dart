import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:portal_animal/util/formato.dart';

void main() {
  setUpAll(() => initializeDateFormatting('es'));

  test('hhmm recorta los segundos', () {
    expect(hhmm('09:30:00'), '09:30');
    expect(hhmm(null), '');
  });

  test('pesos en CLP sin decimales', () {
    expect(pesos(12990), contains('12.990'));
    expect(pesos('5000'), contains('5.000'));
  });

  test('cita vigente solo si es futura y no está cerrada', () {
    expect(citaVigente({'date': '2999-01-01', 'status': 'RESERVADA'}), isTrue);
    expect(citaVigente({'date': '2999-01-01', 'status': 'CANCELADA'}), isFalse);
    expect(citaVigente({'date': '2000-01-01', 'status': 'RESERVADA'}), isFalse);
  });
}
