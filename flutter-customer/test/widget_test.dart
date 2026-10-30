import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ln_lokasi/main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('id.ln.lokasi/native');

  testWidgets('an unpaired device asks for the server and enrollment code', (tester) async {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'credentials') return {'server': '', 'token': '', 'accepted': false};
      return null;
    });
    await tester.pumpWidget(const LnLokasiApp());
    await tester.pumpAndSettle();
    expect(find.text('Pemasangan LN Lokasi'), findsOneWidget);
    expect(find.text('Kode pemasangan'), findsOneWidget);

    await tester.enterText(find.byType(TextField).last, 'pendek');
    await tester.tap(find.text('Pasang di perangkat ini'));
    await tester.pump();
    expect(find.text('Kode pemasangan terdiri dari 24 karakter.'), findsOneWidget);
  });

  testWidgets('a paired device that has not consented sees the consent screen', (tester) async {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'credentials') return {'server': 'https://contoh.test', 'token': 'token', 'accepted': false};
      return null;
    });
    await tester.pumpWidget(const LnLokasiApp());
    await tester.pumpAndSettle();
    expect(find.text('Izin berbagi lokasi'), findsOneWidget);
    expect(find.text('Setuju dan lanjutkan'), findsOneWidget);
  });

  testWidgets('a consented device without location permission is asked for it', (tester) async {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'credentials') return {'server': 'https://contoh.test', 'token': 'token', 'accepted': true};
      if (call.method == 'permissions') return {'foreground': false, 'background': false, 'notification': false};
      return null;
    });
    await tester.pumpWidget(const LnLokasiApp());
    await tester.pumpAndSettle();
    expect(find.text('Izin lokasi perangkat'), findsOneWidget);
  });
}
