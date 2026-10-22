import 'api.dart';
import 'auth.dart';

// Portal del tutor (equivale a composables/usePortal.js).
class Portal {
  static final _dio = Api.instance.dio;

  static List<Json> _lista(dynamic lista) => (lista as List).map((e) => Json.from(e as Map)).toList();

  // -> { perfil, completo }
  static Future<Json> perfil() async => Json.from((await _dio.get('/portal/perfil')).data as Map);

  static Future<List<Json>> mascotas() async => _lista((await _dio.get('/portal/mascotas')).data['mascotas']);

  // Especies con sus razas: [{ id, name, razas: [{ id, name }] }]
  static Future<List<Json>> especies() async => _lista((await _dio.get('/portal/especies')).data['especies']);

  static Future<List<Json>> citas() async => _lista((await _dio.get('/portal/citas')).data['citas']);

  static Future<Json> cancelarCita(String id) async =>
      Json.from((await _dio.post('/portal/citas/$id/cancelar')).data['cita'] as Map);
}
