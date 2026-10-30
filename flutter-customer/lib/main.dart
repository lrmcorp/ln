import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:permission_handler/permission_handler.dart';

// Flutter screens for the LN customer location app. Credentials live in the native
// Keystore-backed store and the foreground location service is the proven native one;
// this layer only drives enrollment, consent and permissions.
const _native = MethodChannel('id.ln.lokasi/native');
const _ink = Color(0xFF182521);
const _paper = Color(0xFFF5F3EE);
const _accent = Color(0xFF0C6150);

void main() => runApp(const LnLokasiApp());

class LnLokasiApp extends StatelessWidget {
  const LnLokasiApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'LN Lokasi',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: _accent, surface: _paper),
          scaffoldBackgroundColor: _paper,
          filledButtonTheme: FilledButtonThemeData(
            style: FilledButton.styleFrom(backgroundColor: _accent, minimumSize: const Size.fromHeight(52)),
          ),
        ),
        home: const Flow(),
      );
}

enum Stage { loading, enroll, consent, permission, background, notice, inactive, error, blank }

class Flow extends StatefulWidget {
  const Flow({super.key});
  @override
  State<Flow> createState() => _FlowState();
}

class _FlowState extends State<Flow> with WidgetsBindingObserver {
  Stage stage = Stage.loading;
  String server = '';
  String token = '';
  bool accepted = false;
  String message = '';
  bool busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Returning from Android settings re-checks permissions.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && stage != Stage.enroll) _advance();
  }

  Future<void> _load() async {
    final stored = Map<String, dynamic>.from(await _native.invokeMethod('credentials') as Map);
    server = stored['server'] as String? ?? '';
    token = stored['token'] as String? ?? '';
    accepted = stored['accepted'] as bool? ?? false;
    await _advance();
  }

  Future<http.Response> _call(String path, {Object? body}) {
    final uri = Uri.parse('$server$path');
    final headers = {'Content-Type': 'application/json', if (token.isNotEmpty) 'Authorization': 'Bearer $token'};
    final request = body == null ? http.get(uri, headers: headers) : http.post(uri, headers: headers, body: jsonEncode(body));
    return request.timeout(const Duration(seconds: 20));
  }

  String _error(http.Response response, String fallback) {
    try {
      return (jsonDecode(response.body) as Map)['error'] as String? ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  Future<void> _advance() async {
    if (token.isEmpty) return setState(() => stage = Stage.enroll);
    if (!accepted) return setState(() => stage = Stage.consent);
    if (!(await Permission.locationWhenInUse.isGranted)) return setState(() => stage = Stage.permission);
    if (!(await Permission.locationAlways.isGranted)) return setState(() => stage = Stage.background);
    if (await Permission.notification.isDenied) return setState(() => stage = Stage.notice);
    await _start();
  }

  Future<void> _enroll(String url, String code) async {
    final secure = url.startsWith('https://') || (kDebugMode && url.startsWith('http://'));
    if (!secure) return setState(() => message = 'Gunakan alamat HTTPS yang diberikan petugas.');
    if (code.length != 24) return setState(() => message = 'Kode pemasangan terdiri dari 24 karakter.');
    setState(() {busy = true; message = 'Menghubungkan perangkat…';});
    try {
      server = url.replaceAll(RegExp(r'/+$'), '');
      token = '';
      final response = await _call('/api/mobile/activate', body: {'code': code});
      if (response.statusCode != 200) throw Exception(_error(response, 'Pemasangan gagal'));
      token = (jsonDecode(response.body) as Map)['token'] as String;
      await _native.invokeMethod('save', {'server': server, 'token': token});
      message = '';
      setState(() => stage = Stage.consent);
    } catch (cause) {
      setState(() => message = cause.toString().replaceFirst('Exception: ', ''));
    } finally {
      setState(() => busy = false);
    }
  }

  Future<void> _start() async {
    setState(() {busy = true; stage = Stage.loading;});
    try {
      final status = await _call('/api/mobile/status');
      if (status.statusCode == 401) {
        await _native.invokeMethod('clear');
        token = '';
        accepted = false;
        return setState(() => stage = Stage.enroll);
      }
      if (status.statusCode != 200) throw Exception(_error(status, 'Status perangkat tidak terbaca'));
      final body = jsonDecode(status.body) as Map;
      if (body['active'] != true) return setState(() => stage = Stage.inactive);
      if (body['enabled'] != true) {
        final consent = await _call('/api/mobile/consent', body: {'enabled': true});
        if (consent.statusCode != 200) throw Exception(_error(consent, 'Izin belum tersimpan'));
      }
      await _native.invokeMethod('startService');
      setState(() => stage = Stage.blank);
    } catch (cause) {
      setState(() {message = cause.toString().replaceFirst('Exception: ', ''); stage = Stage.error;});
    } finally {
      busy = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    // After setup the screen stays intentionally blank; the Android notification shows reporting is on.
    if (stage == Stage.blank) return const Scaffold(body: SizedBox.expand());
    if (stage == Stage.loading) return const Scaffold(body: Center(child: CircularProgressIndicator(color: _accent)));
    return Scaffold(body: SafeArea(child: ListView(padding: const EdgeInsets.fromLTRB(24, 40, 24, 32), children: _content())));
  }

  List<Widget> _content() {
    switch (stage) {
      case Stage.enroll:
        return [_EnrollmentForm(busy: busy, message: message, onSubmit: _enroll)];
      case Stage.consent:
        return _panel('Izin berbagi lokasi',
            'Saya setuju membagikan perkiraan lokasi kepada superadmin dan manajer cabang selama pinjaman aktif. Petugas lapangan tidak dapat melihatnya. Android akan meminta izin lokasi sepanjang waktu dan menampilkan pemberitahuan saat layanan berjalan.',
            'Setuju dan lanjutkan', () async {
          await _native.invokeMethod('setAccepted', {'value': true});
          accepted = true;
          await _advance();
        });
      case Stage.permission:
        return _panel('Izin lokasi perangkat',
            'Berikan izin lokasi saat aplikasi digunakan. Setelah itu, aktifkan izin sepanjang waktu agar pelaporan tetap berjalan ketika layar aplikasi ditutup.',
            'Izinkan lokasi', () async {
          await Permission.locationWhenInUse.request();
          await _advance();
        });
      case Stage.background:
        return _panel('Izin lokasi sepanjang waktu',
            "Di pengaturan Android, pilih izin lokasi 'Izinkan sepanjang waktu', lalu kembali ke aplikasi. Tanpa izin ini, pelaporan latar belakang tidak dimulai.",
            'Buka pengaturan izin', () async {
          final status = await Permission.locationAlways.request();
          if (!status.isGranted) await openAppSettings();
          await _advance();
        });
      case Stage.notice:
        return _panel('Pemberitahuan', 'Izinkan pemberitahuan agar Anda selalu melihat saat lokasi sedang dibagikan dan dapat menghentikannya.',
            'Izinkan pemberitahuan', () async {
          await Permission.notification.request();
          await _start();
        });
      case Stage.inactive:
        return _panel('Pinjaman belum aktif', 'Pelaporan lokasi dimulai setelah pinjaman aktif.', 'Periksa lagi', _start);
      case Stage.error:
        return _panel('Lokasi belum aktif', message.isEmpty ? 'Periksa jaringan dan coba lagi.' : message, 'Coba lagi', _start);
      default:
        return const [];
    }
  }

  List<Widget> _panel(String title, String body, String action, Future<void> Function() onPressed) => [
        Text(title, style: const TextStyle(fontSize: 26, color: _ink, fontFamily: 'serif')),
        const SizedBox(height: 16),
        Text(body, style: const TextStyle(fontSize: 16, height: 1.5, color: _ink)),
        const SizedBox(height: 28),
        FilledButton(onPressed: busy ? null : onPressed, child: Text(action)),
      ];
}

class _EnrollmentForm extends StatefulWidget {
  const _EnrollmentForm({required this.busy, required this.message, required this.onSubmit});
  final bool busy;
  final String message;
  final Future<void> Function(String server, String code) onSubmit;
  @override
  State<_EnrollmentForm> createState() => _EnrollmentFormState();
}

class _EnrollmentFormState extends State<_EnrollmentForm> {
  final server = TextEditingController(text: 'https://int.lnint.xyz');
  final code = TextEditingController();

  @override
  void dispose() {
    server.dispose();
    code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Pemasangan LN Lokasi', style: TextStyle(fontSize: 26, color: _ink, fontFamily: 'serif')),
        const SizedBox(height: 16),
        const Text('Masukkan alamat server dan kode sekali pakai dari petugas. Pemasangan hanya dapat dibuat untuk pinjaman yang sudah aktif.',
            style: TextStyle(fontSize: 16, height: 1.5, color: _ink)),
        const SizedBox(height: 24),
        TextField(controller: server, keyboardType: TextInputType.url, autocorrect: false, decoration: const InputDecoration(labelText: 'Alamat server', border: OutlineInputBorder())),
        const SizedBox(height: 16),
        TextField(controller: code, autocorrect: false, maxLength: 24, decoration: const InputDecoration(labelText: 'Kode pemasangan', border: OutlineInputBorder())),
        if (widget.message.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(widget.message, style: const TextStyle(color: Color(0xFF8F3329)))),
        FilledButton(
          onPressed: widget.busy ? null : () => widget.onSubmit(server.text.trim(), code.text.trim()),
          child: Text(widget.busy ? 'Menghubungkan…' : 'Pasang di perangkat ini'),
        ),
        const SizedBox(height: 20),
        const Text('Lokasi hanya dilaporkan setelah izin diberikan, saat pinjaman aktif. Android menampilkan pemberitahuan selama pelaporan berjalan.',
            style: TextStyle(fontSize: 14, height: 1.5, color: Color(0xFF596761))),
      ]);
}
