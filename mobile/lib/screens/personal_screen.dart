import 'package:flutter/material.dart';

import '../api/auth.dart';

// La app es para tutores; el personal de la clínica trabaja en el portal web.
class PersonalScreen extends StatelessWidget {
  const PersonalScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = Auth.instance;
    return Scaffold(
      appBar: AppBar(title: const Text('Portal Animal')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('🩺', style: TextStyle(fontSize: 48)),
              const SizedBox(height: 12),
              Text('Hola, ${auth.primerNombre}', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 8),
              Text(
                'Esta app es para tutores de mascotas. '
                'La agenda, recepción y caja${auth.organizacion?['name'] != null ? ' de ${auth.organizacion!['name']}' : ''} '
                'se gestionan en el portal web.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              OutlinedButton.icon(onPressed: auth.logout, icon: const Icon(Icons.logout), label: const Text('Cerrar sesión')),
            ],
          ),
        ),
      ),
    );
  }
}
