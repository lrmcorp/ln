# LN Lokasi Flutter (demo)

Versi Flutter dari aplikasi lokasi nasabah. Alurnya sama dengan APK native di `android-customer/`: masukkan alamat server dan kode pemasangan dari petugas, setujui berbagi lokasi, beri izin lokasi **sepanjang waktu** dan izin pemberitahuan, lalu layar menjadi kosong sementara layanan lokasi Android melaporkan lokasi ke `/api/mobile/*`. Hanya untuk **data rekaan**.

Layar dan panggilan API ditulis di Flutter (`lib/main.dart`). Penyimpanan token (Android Keystore) dan layanan lokasi latar depan memakai kelas Java yang sama dengan APK native (`android/app/src/main/java/id/ln/lokasi/`), dihubungkan lewat `MethodChannel` `id.ln.lokasi/native`. Dengan begitu perilaku latar belakang, pemberitahuan **Hentikan berbagi**, dan mulai ulang saat boot sama dengan versi native yang sudah diuji. ID aplikasi `id.ln.lokasi.flutter` berbeda dari APK native sehingga keduanya bisa terpasang bersamaan.

## Build

Flutter 3.47.7 (stable) dan JDK 17. Dari folder ini:

```bash
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

Kontainer cloud pengembangan tidak dapat menjangkau `dl.google.com` (Android SDK), jadi APK dibangun oleh workflow GitHub Actions **Build Flutter customer APK** (`.github/workflows/flutter-apk.yml`) setiap ada perubahan di folder ini. APK debug tersedia sebagai artefak `ln-lokasi-flutter-debug` di halaman run tersebut.

## Batasan

Sama dengan APK native: build debug bertanda tangan debug, belum diuji di perangkat fisik, Android dapat menghentikan layanan (hemat baterai, paksa berhenti), lokasi bisa dipalsukan, dan belum ada geofence. Build debug mengizinkan HTTP hanya untuk emulator lokal; build rilis menolak HTTP.
