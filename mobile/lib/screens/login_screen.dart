import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../api/api.dart';
import '../api/auth.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _ocupado = false;
  String _error = '';

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _ingresar(Future<void> Function() accion) async {
    setState(() {
      _ocupado = true;
      _error = '';
    });
    try {
      await accion();
    } on GoogleSignInException catch (e) {
      if (e.code != GoogleSignInExceptionCode.canceled) _error = e.description ?? 'No se pudo ingresar con Google';
    } catch (e) {
      _error = mensajeError(e);
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  void _conEmail() {
    if (!_form.currentState!.validate()) return;
    _ingresar(() => Auth.instance.loginConEmail(_email.text.trim(), _password.text));
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 28, 20, 20),
                child: Form(
                  key: _form,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text('🐾', textAlign: TextAlign.center, style: TextStyle(fontSize: 44)),
                      Text(
                        'Portal Animal',
                        textAlign: TextAlign.center,
                        style: tema.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Reserva horas y revisa el historial de tus mascotas.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: tema.colorScheme.onSurfaceVariant),
                      ),
                      const SizedBox(height: 24),
                      OutlinedButton(
                        onPressed: _ocupado ? null : () => _ingresar(Auth.instance.loginConGoogle),
                        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                        child: const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text('G', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF4285F4))),
                            SizedBox(width: 10),
                            Text('Continuar con Google'),
                          ],
                        ),
                      ),
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 16),
                        child: Row(children: [Expanded(child: Divider()), Text('  o  '), Expanded(child: Divider())]),
                      ),
                      TextFormField(
                        controller: _email,
                        decoration: const InputDecoration(labelText: 'Email'),
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        textInputAction: TextInputAction.next,
                        validator: (v) => (v == null || !v.contains('@')) ? 'Ingresa tu email' : null,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _password,
                        decoration: const InputDecoration(labelText: 'Contraseña'),
                        obscureText: true,
                        autofillHints: const [AutofillHints.password],
                        onFieldSubmitted: (_) => _conEmail(),
                        validator: (v) => (v == null || v.isEmpty) ? 'Ingresa tu contraseña' : null,
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: _ocupado ? null : _conEmail,
                        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                        child: Text(_ocupado ? 'Ingresando…' : 'Ingresar'),
                      ),
                      if (_error.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        Text(_error, textAlign: TextAlign.center, style: TextStyle(color: tema.colorScheme.error)),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
