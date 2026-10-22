import 'package:flutter/material.dart';

import '../api/auth.dart';
import '../widgets/comunes.dart';
import 'citas_screen.dart';
import 'inicio_screen.dart';
import 'mascotas_screen.dart';

// Portal del tutor: navegación inferior entre Inicio, Mascotas y Citas.
class TutorShell extends StatefulWidget {
  const TutorShell({super.key});

  @override
  State<TutorShell> createState() => _TutorShellState();
}

class _TutorShellState extends State<TutorShell> {
  int _pestana = 0;
  // Cambia la key para recargar una pestaña al volver a ella.
  final _versiones = [0, 0, 0];

  void _ir(int i) => setState(() {
        if (i != _pestana) _versiones[i]++;
        _pestana = i;
      });

  Future<void> _salir() async {
    final ok = await confirmar(context, titulo: '¿Cerrar sesión?', mensaje: 'Tendrás que volver a ingresar.', aceptar: 'Cerrar sesión');
    if (ok) await Auth.instance.logout();
  }

  @override
  Widget build(BuildContext context) {
    final pantallas = [
      InicioScreen(key: ValueKey('i${_versiones[0]}'), irA: _ir),
      MascotasScreen(key: ValueKey('m${_versiones[1]}')),
      CitasScreen(key: ValueKey('c${_versiones[2]}')),
    ];
    return Scaffold(
      appBar: AppBar(
        title: const Text('Portal Animal'),
        actions: [IconButton(tooltip: 'Cerrar sesión', icon: const Icon(Icons.logout), onPressed: _salir)],
      ),
      body: pantallas[_pestana],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _pestana,
        onDestinationSelected: _ir,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Inicio'),
          NavigationDestination(icon: Icon(Icons.pets_outlined), selectedIcon: Icon(Icons.pets), label: 'Mascotas'),
          NavigationDestination(icon: Icon(Icons.event_outlined), selectedIcon: Icon(Icons.event), label: 'Citas'),
        ],
      ),
    );
  }
}
