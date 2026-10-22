import 'package:flutter/material.dart';

import '../api/auth.dart';
import '../api/portal.dart';
import '../util/formato.dart';
import '../widgets/comunes.dart';
import 'citas_screen.dart';

typedef _DatosInicio = ({Json perfil, List<Json> mascotas, List<Json> citas});

class InicioScreen extends StatelessWidget {
  const InicioScreen({super.key, required this.irA});

  // Cambia de pestaña: 1 = mascotas, 2 = citas.
  final void Function(int) irA;

  static Future<_DatosInicio> _cargar() async {
    final (perfil, mascotas, citas) = await (Portal.perfil(), Portal.mascotas(), Portal.citas()).wait;
    return (perfil: perfil, mascotas: mascotas, citas: citas);
  }

  @override
  Widget build(BuildContext context) {
    return Cargador<_DatosInicio>(
      cargar: _cargar,
      builder: (context, d, recargar) {
        final proximas = d.citas.where(citaVigente).toList()..sort(porFechaHora);
        final pendientes =
            d.citas.where((c) => c['payment_status'] == 'PENDIENTE' && c['status'] != 'CANCELADA').length;
        return RefreshIndicator(
          onRefresh: recargar,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Hola, ${Auth.instance.primerNombre} 👋', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 12),
              if (d.perfil['completo'] != true)
                const Aviso(
                  titulo: 'Completa tu perfil',
                  texto: 'Necesitamos tus nombres, apellidos y dirección para reservar. '
                      'Por ahora puedes completarlo en el portal web.',
                ),
              if (d.perfil['completo'] == true && d.mascotas.isEmpty)
                Aviso(
                  titulo: 'Registra a tu primera mascota',
                  texto: 'Para reservar una hora necesitas al menos una mascota registrada.',
                  accion: 'Ver mis mascotas',
                  alPulsar: () => irA(1),
                ),
              if (pendientes > 0)
                Aviso(
                  titulo: 'Tienes $pendientes reserva(s) con el pago pendiente',
                  texto: 'El horario se libera si no completas el pago a tiempo.',
                  accion: 'Ir a mis citas',
                  alPulsar: () => irA(2),
                ),
              const SizedBox(height: 8),
              Text('Próximas citas', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              if (proximas.isEmpty)
                const Card(child: Padding(padding: EdgeInsets.all(16), child: Text('No tienes citas próximas.')))
              else ...[
                for (final c in proximas.take(3)) TarjetaCita(cita: c),
                TextButton(onPressed: () => irA(2), child: const Text('Ver todas mis citas')),
              ],
            ],
          ),
        );
      },
    );
  }
}
