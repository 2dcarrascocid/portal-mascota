import 'package:flutter/material.dart';

import '../api/auth.dart';
import '../api/portal.dart';
import '../util/formato.dart';
import '../widgets/comunes.dart';

typedef _DatosMascotas = ({List<Json> mascotas, List<Json> especies});

class MascotasScreen extends StatelessWidget {
  const MascotasScreen({super.key});

  static Future<_DatosMascotas> _cargar() async {
    final (mascotas, especies) = await (Portal.mascotas(), Portal.especies()).wait;
    return (mascotas: mascotas, especies: especies);
  }

  @override
  Widget build(BuildContext context) {
    return Cargador<_DatosMascotas>(
      cargar: _cargar,
      builder: (context, d, recargar) {
        Json? especie(Object? id) => d.especies.where((e) => e['id'] == id).firstOrNull;
        String raza(Json? esp, Object? id) =>
            ((esp?['razas'] as List?) ?? const []).cast<Map>().where((r) => r['id'] == id).firstOrNull?['name'] as String? ?? '';

        return RefreshIndicator(
          onRefresh: recargar,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Mis mascotas', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 12),
              if (d.mascotas.isEmpty)
                const Card(
                  child: Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('Aún no registras mascotas. Agrega la primera para poder reservar horas.'),
                  ),
                ),
              for (final m in d.mascotas)
                _TarjetaMascota(
                  mascota: m,
                  especie: especie(m['species_id'])?['name'] as String? ?? '',
                  raza: raza(especie(m['species_id']), m['breed_id']),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _TarjetaMascota extends StatelessWidget {
  const _TarjetaMascota({required this.mascota, required this.especie, required this.raza});

  final Json mascota;
  final String especie;
  final String raza;

  @override
  Widget build(BuildContext context) {
    final m = mascota;
    final datos = <(String, String)>[
      if (raza.isNotEmpty) ('Raza', raza),
      if (m['birth_date'] != null) ('Edad', edad(m['birth_date'] as String)),
      if (m['weight'] != null && '${m['weight']}'.isNotEmpty) ('Peso', '${m['weight']} kg'),
      if (m['microchip_number'] != null && '${m['microchip_number']}'.isNotEmpty) ('Microchip', '${m['microchip_number']}'),
    ];
    final suave = TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text('${m['name']}', style: Theme.of(context).textTheme.titleMedium)),
                if (especie.isNotEmpty) Chip2(especie),
              ],
            ),
            const SizedBox(height: 6),
            for (final (etiqueta, valor) in datos)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Row(children: [SizedBox(width: 80, child: Text(etiqueta, style: suave)), Expanded(child: Text(valor))]),
              ),
            if (m['notes'] != null && '${m['notes']}'.isNotEmpty)
              Padding(padding: const EdgeInsets.only(top: 6), child: Text('${m['notes']}', style: suave)),
          ],
        ),
      ),
    );
  }
}
