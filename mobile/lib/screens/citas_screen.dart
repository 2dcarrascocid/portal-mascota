import 'package:flutter/material.dart';

import '../api/api.dart';
import '../api/auth.dart';
import '../api/portal.dart';
import '../util/formato.dart';
import '../widgets/comunes.dart';

class CitasScreen extends StatelessWidget {
  const CitasScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Cargador<List<Json>>(
      cargar: Portal.citas,
      builder: (context, citas, recargar) {
        final proximas = citas.where(citaVigente).toList()..sort(porFechaHora);
        final anteriores = citas.where((c) => !citaVigente(c)).toList()..sort((a, b) => porFechaHora(b, a));
        final titulo = Theme.of(context).textTheme.titleMedium;
        return RefreshIndicator(
          onRefresh: recargar,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Mis citas', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 12),
              Text('Próximas', style: titulo),
              const SizedBox(height: 8),
              if (proximas.isEmpty) const Card(child: Padding(padding: EdgeInsets.all(16), child: Text('No tienes citas próximas.'))),
              for (final c in proximas) TarjetaCita(cita: c, alCambiar: recargar),
              const SizedBox(height: 16),
              Text('Anteriores y canceladas', style: titulo),
              const SizedBox(height: 8),
              if (anteriores.isEmpty) const Card(child: Padding(padding: EdgeInsets.all(16), child: Text('Sin citas anteriores.'))),
              for (final c in anteriores) TarjetaCita(cita: c, compacta: true),
            ],
          ),
        );
      },
    );
  }
}

// Tarjeta de una cita. Con `alCambiar` muestra el botón Cancelar cuando corresponde.
class TarjetaCita extends StatefulWidget {
  const TarjetaCita({super.key, required this.cita, this.alCambiar, this.compacta = false});

  final Json cita;
  final Future<void> Function()? alCambiar;
  final bool compacta;

  @override
  State<TarjetaCita> createState() => _TarjetaCitaState();
}

class _TarjetaCitaState extends State<TarjetaCita> {
  bool _ocupada = false;

  Json? _sub(String clave) => widget.cita[clave] as Json?;

  bool get _cancelable {
    final c = widget.cita;
    return const ['RESERVADA', 'CONFIRMADA'].contains(c['status']) &&
        (c['date'] as String).compareTo(hoy()) >= 0 &&
        c['payment_status'] != 'PAGADO';
  }

  Future<void> _cancelar() async {
    final c = widget.cita;
    final ok = await confirmar(
      context,
      titulo: '¿Cancelar la cita?',
      mensaje: '${_sub('service')?['name'] ?? 'Cita'} para ${_sub('pet')?['name'] ?? 'tu mascota'}, '
          '${fechaCorta(c['date'] as String)} a las ${hhmm(c['start_time'] as String?)}.\n\n'
          'El horario queda libre para otras personas.',
      aceptar: 'Cancelar cita',
      peligro: true,
    );
    if (!ok || !mounted) return;
    setState(() => _ocupada = true);
    try {
      await Portal.cancelarCita(c['id'] as String);
      await widget.alCambiar?.call();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensajeError(e))));
    } finally {
      if (mounted) setState(() => _ocupada = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.cita;
    final tema = Theme.of(context);
    final suave = TextStyle(color: tema.colorScheme.onSurfaceVariant, fontSize: 13);
    final lugar = [_sub('organization')?['name'], _sub('branch')?['name']].whereType<String>().join(' — ');
    final direccion = [_sub('branch')?['address'], _sub('branch')?['city']].whereType<String>().join(', ');
    final profesional = _sub('staff')?['full_name'] as String?;
    final estado = c['status'] as String?;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 72,
              padding: const EdgeInsets.symmetric(vertical: 8),
              decoration: BoxDecoration(
                color: tema.colorScheme.primary.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                children: [
                  Text(fechaCorta(c['date'] as String, anio: widget.compacta),
                      textAlign: TextAlign.center,
                      style: TextStyle(color: tema.colorScheme.primary, fontWeight: FontWeight.bold, fontSize: 12)),
                  Text(hhmm(c['start_time'] as String?), style: TextStyle(color: tema.colorScheme.primary)),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${_sub('service')?['name'] ?? 'Atención'} · ${_sub('pet')?['name'] ?? 'Mascota'}',
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  if (lugar.isNotEmpty) Text(lugar, style: suave),
                  if (!widget.compacta && (direccion.isNotEmpty || profesional != null))
                    Text([direccion, if (profesional != null) 'con $profesional'].where((s) => s.isNotEmpty).join(' · '),
                        style: suave),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      Chip2(estadosCita[estado] ?? '$estado',
                          color: estado == 'CONFIRMADA' ? tema.colorScheme.primary : null),
                      if (c['payment_status'] == 'PAGADO')
                        Chip2('Pagado ${pesos(c['payment_amount'])}', color: const Color(0xFF2F9E5B)),
                      if (c['payment_status'] == 'PENDIENTE' && estado != 'CANCELADA')
                        Chip2('Pago pendiente ${pesos(c['payment_amount'])}', color: const Color(0xFFB7791F)),
                    ],
                  ),
                  if (widget.compacta && c['cancel_reason'] != null)
                    Padding(padding: const EdgeInsets.only(top: 4), child: Text('${c['cancel_reason']}', style: suave)),
                  if (widget.alCambiar != null && _cancelable)
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: _ocupada ? null : _cancelar,
                        style: TextButton.styleFrom(foregroundColor: tema.colorScheme.error),
                        child: Text(_ocupada ? 'Cancelando…' : 'Cancelar'),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
