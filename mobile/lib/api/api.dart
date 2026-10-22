import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../config.dart';

// Sesión emitida por el backend: { access_token, refresh_token, expires_at }.
class Sesion {
  Sesion.fromJson(Map<String, dynamic> j)
      : accessToken = j['access_token'] as String,
        refreshToken = j['refresh_token'] as String,
        expiresAt = (j['expires_at'] as num).toInt();

  final String accessToken;
  final String refreshToken;
  final int expiresAt; // segundos epoch

  bool get porVencer => expiresAt * 1000 - DateTime.now().millisecondsSinceEpoch < 60000;
}

BaseOptions _opciones() => BaseOptions(
      baseUrl: Config.apiUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
    );

// Cliente HTTP único: agrega el Bearer y renueva el access token igual que services/api.js del frontend.
class Api {
  Api._() {
    dio.interceptors.add(InterceptorsWrapper(onRequest: _alPedir, onError: _alFallar));
  }

  static final instance = Api._();

  static const _claveSesion = 'pc_sesion';
  final dio = Dio(_opciones());
  final _almacen = const FlutterSecureStorage();
  Sesion? _sesion;

  // Lo registra Auth para cerrar sesión cuando ya no se puede renovar.
  void Function() alExpirar = () {};

  String? get refreshToken => _sesion?.refreshToken;

  Future<Sesion?> cargarSesion() async {
    final texto = await _almacen.read(key: _claveSesion);
    if (texto == null) return null;
    try {
      _sesion = Sesion.fromJson(jsonDecode(texto) as Map<String, dynamic>);
    } catch (_) {
      _sesion = null;
    }
    return _sesion;
  }

  Future<void> guardarSesion(Map<String, dynamic> json) async {
    _sesion = Sesion.fromJson(json);
    await _almacen.write(key: _claveSesion, value: jsonEncode(json));
  }

  Future<void> limpiarSesion() async {
    _sesion = null;
    await _almacen.delete(key: _claveSesion);
  }

  // Renueva una sola vez aunque haya varias peticiones esperando.
  Future<Sesion>? _renovando;
  Future<Sesion> _renovar() => _renovando ??= _pedirRenovacion().whenComplete(() => _renovando = null);

  Future<Sesion> _pedirRenovacion() async {
    try {
      final res = await Dio(_opciones()).post('/auth/refresh', data: {'refresh_token': _sesion?.refreshToken});
      await guardarSesion(Map<String, dynamic>.from(res.data['sesion'] as Map));
      return _sesion!;
    } on DioException catch (e) {
      // Rechazo del backend = sesión inválida. Sin red se conserva.
      if (e.response != null) await _expirar();
      rethrow;
    }
  }

  Future<void> _expirar() async {
    await limpiarSesion();
    alExpirar();
  }

  Future<void> _alPedir(RequestOptions opciones, RequestInterceptorHandler handler) async {
    var sesion = _sesion;
    if (sesion != null && sesion.porVencer) {
      try {
        sesion = await _renovar();
      } catch (_) {
        sesion = _sesion;
      }
    }
    if (sesion != null) opciones.headers['Authorization'] = 'Bearer ${sesion.accessToken}';
    handler.next(opciones);
  }

  // Token revocado o vencido: un reintento tras renovar.
  Future<void> _alFallar(DioException err, ErrorInterceptorHandler handler) async {
    final opciones = err.requestOptions;
    if (err.response?.statusCode != 401 || _sesion == null) return handler.next(err);
    if (opciones.extra['reintento'] == true) {
      await _expirar();
      return handler.next(err);
    }
    try {
      await _renovar();
      opciones.extra['reintento'] = true;
      handler.resolve(await dio.fetch(opciones));
    } catch (_) {
      handler.next(err);
    }
  }
}

// Mensaje legible a partir de un error.
String mensajeError(Object err) {
  if (err is DioException) {
    final data = err.response?.data;
    if (data is Map && data['error'] is String) return data['error'] as String;
    if (err.response == null) return 'No se pudo conectar con el servidor';
    return err.message ?? 'Error inesperado';
  }
  return err.toString().replaceFirst('Exception: ', '');
}
