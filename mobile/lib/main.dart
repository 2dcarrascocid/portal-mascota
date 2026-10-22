import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';

import 'api/auth.dart';
import 'screens/login_screen.dart';
import 'screens/personal_screen.dart';
import 'screens/tutor_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('es');
  Intl.defaultLocale = 'es';
  runApp(const PortalAnimalApp());
  Auth.instance.iniciar();
}

// Colores del portal web (botón principal naranjo, fondo cálido).
const _acento = Color(0xFFC4581B);

final _tema = ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(seedColor: _acento, primary: _acento),
  scaffoldBackgroundColor: const Color(0xFFF6F5F2),
  cardTheme: const CardThemeData(
    color: Colors.white,
    elevation: 0,
    margin: EdgeInsets.only(bottom: 10),
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(12)),
      side: BorderSide(color: Color(0xFFE6E2DC)),
    ),
  ),
  inputDecorationTheme: const InputDecorationTheme(
    border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(8))),
  ),
);

class PortalAnimalApp extends StatelessWidget {
  const PortalAnimalApp({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = Auth.instance;
    return MaterialApp(
      title: 'Portal Animal',
      debugShowCheckedModeBanner: false,
      theme: _tema,
      home: ListenableBuilder(
        listenable: auth,
        builder: (context, _) {
          if (!auth.cargado) return const Scaffold(body: Center(child: CircularProgressIndicator()));
          if (!auth.autenticado) return const LoginScreen();
          if (!auth.esTutor) return const PersonalScreen();
          return const TutorShell();
        },
      ),
    );
  }
}
