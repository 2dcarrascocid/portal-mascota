import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../config.dart';
import 'api.dart';

typedef Json = Map<String, dynamic>;

// Estado de la cuenta para toda la app (equivale a composables/useAuth.js).
class Auth extends ChangeNotifier {
  Auth._();

  static final instance = Auth._();

  final _api = Api.instance;
  Json? usuario;
  Json? perfil;
  Json? organizacion;
  bool cargado = false;

  bool get autenticado => usuario != null;
  String? get rol => perfil?['role'] as String?;
  // Tutor de mascotas: usa el portal del tutor.
  bool get esTutor => rol == 'CLIENT';
  String get primerNombre {
    final nombre = (perfil?['full_name'] as String?)?.trim() ?? '';
    return nombre.isEmpty ? 'tutor/a' : nombre.split(' ').first;
  }

  // Carga la sesión guardada al abrir la app.
  Future<void> iniciar() async {
    _api.alExpirar = _limpiarLocal;
    if (await _api.cargarSesion() != null) {
      try {
        _aplicar((await _api.dio.get('/auth/me')).data as Map);
      } on DioException catch (e) {
        // Sesión rechazada; otros errores (500, sin red) mandan al login sin borrarla.
        if (e.response?.statusCode == 401) await _api.limpiarSesion();
      }
    }
    cargado = true;
    notifyListeners();
  }

  void _aplicar(Map data) {
    usuario = Json.from(data['usuario'] as Map);
    perfil = Json.from(data['perfil'] as Map);
    organizacion = data['organizacion'] == null ? null : Json.from(data['organizacion'] as Map);
    notifyListeners();
  }

  Future<void> _iniciarSesion(Map data) async {
    await _api.guardarSesion(Json.from(data['sesion'] as Map));
    _aplicar(data);
  }

  Future<void> loginConEmail(String email, String password) async {
    final res = await _api.dio.post('/auth/login', data: {'email': email, 'password': password});
    await _iniciarSesion(res.data as Map);
  }

  bool _googleListo = false;

  // Google nativo: el backend verifica el ID token igual que con el botón de la web.
  // Lanza GoogleSignInException(code: canceled) si la persona cierra el selector.
  Future<void> loginConGoogle() async {
    final google = GoogleSignIn.instance;
    if (!_googleListo) {
      await google.initialize(serverClientId: Config.googleClientId);
      _googleListo = true;
    }
    final cuenta = await google.authenticate();
    final idToken = cuenta.authentication.idToken;
    if (idToken == null) throw Exception('Google no entregó el token de identidad');
    final res = await _api.dio.post('/auth/google/token', data: {'credential': idToken});
    await _iniciarSesion(res.data as Map);
  }

  Future<void> logout() async {
    try {
      final refresh = _api.refreshToken;
      if (refresh != null) await _api.dio.post('/auth/logout', data: {'refresh_token': refresh});
    } catch (_) {
      // sin red o token vencido: igual cerramos la sesión local
    }
    if (_googleListo) {
      try {
        await GoogleSignIn.instance.signOut();
      } catch (_) {}
    }
    await _api.limpiarSesion();
    _limpiarLocal();
  }

  void _limpiarLocal() {
    usuario = null;
    perfil = null;
    organizacion = null;
    notifyListeners();
  }
}
