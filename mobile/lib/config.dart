// Configuración por --dart-define (ej: flutter run --dart-define=API_URL=https://api.portalanimal.cl).
class Config {
  // En el emulador, localhost llega al PC gracias a `adb reverse tcp:3000 tcp:3000`.
  static const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3000');

  // Client ID *web* de Google (el mismo VITE_GOOGLE_CLIENT_ID del frontend): el backend
  // valida que el ID token venga emitido para él. Es público, no es un secreto.
  static const googleClientId = String.fromEnvironment(
    'GOOGLE_CLIENT_ID',
    defaultValue: '697210287082-0t4stg6fqmo84cfae611l6hnficfn5qc.apps.googleusercontent.com',
  );
}
