import 'package:flutter/material.dart';

import '../api/api.dart';

// Carga datos con un future y muestra cargando / error con reintento / contenido.
// `recargar` sirve para RefreshIndicator y después de una acción.
class Cargador<T> extends StatefulWidget {
  const Cargador({super.key, required this.cargar, required this.builder});

  final Future<T> Function() cargar;
  final Widget Function(BuildContext context, T datos, Future<void> Function() recargar) builder;

  @override
  State<Cargador<T>> createState() => _CargadorState<T>();
}

class _CargadorState<T> extends State<Cargador<T>> {
  late Future<T> _futuro = widget.cargar();

  Future<void> _recargar() async {
    final futuro = widget.cargar();
    setState(() => _futuro = futuro);
    try {
      await futuro;
    } catch (_) {
      // el error lo muestra el FutureBuilder
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<T>(
      future: _futuro,
      builder: (context, snap) {
        if (snap.hasError && snap.connectionState == ConnectionState.done) {
          return MensajeError(mensaje: mensajeError(snap.error!), alReintentar: _recargar);
        }
        // Al recargar se conserva lo anterior en pantalla.
        if (snap.hasData) return widget.builder(context, snap.data as T, _recargar);
        return const Center(child: CircularProgressIndicator());
      },
    );
  }
}

class MensajeError extends StatelessWidget {
  const MensajeError({super.key, required this.mensaje, this.alReintentar});

  final String mensaje;
  final VoidCallback? alReintentar;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, size: 48, color: Theme.of(context).colorScheme.error),
            const SizedBox(height: 12),
            Text(mensaje, textAlign: TextAlign.center),
            if (alReintentar != null) ...[
              const SizedBox(height: 12),
              OutlinedButton(onPressed: alReintentar, child: const Text('Reintentar')),
            ],
          ],
        ),
      ),
    );
  }
}

class Chip2 extends StatelessWidget {
  const Chip2(this.texto, {super.key, this.color});

  final String texto;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.outline;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(999)),
      child: Text(texto, style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

// Aviso destacado con borde a la izquierda (como .panel.aviso de la web).
class Aviso extends StatelessWidget {
  const Aviso({super.key, required this.titulo, required this.texto, this.accion, this.alPulsar});

  final String titulo;
  final String texto;
  final String? accion;
  final VoidCallback? alPulsar;

  @override
  Widget build(BuildContext context) {
    const color = Color(0xFFD99A1E);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Container(
        decoration: const BoxDecoration(border: Border(left: BorderSide(color: color, width: 4))),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(titulo, style: const TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Text(texto),
            if (accion != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  style: TextButton.styleFrom(padding: EdgeInsets.zero),
                  onPressed: alPulsar,
                  child: Text('$accion →'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

Future<bool> confirmar(
  BuildContext context, {
  required String titulo,
  required String mensaje,
  required String aceptar,
  bool peligro = false,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(titulo),
      content: Text(mensaje),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Volver')),
        FilledButton(
          style: peligro ? FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error) : null,
          onPressed: () => Navigator.pop(context, true),
          child: Text(aceptar),
        ),
      ],
    ),
  );
  return ok ?? false;
}
