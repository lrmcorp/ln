# LN Lokasi Android (demo)

APK Android untuk nasabah dengan layar utama kosong dan layanan lokasi Android yang dapat berjalan setelah aktivitas aplikasi ditutup. APK ini adalah **build debug untuk data rekaan**, belum untuk distribusi kepada nasabah sungguhan.

## Pakai

1. Pastikan pinjaman sudah berstatus **Aktif** setelah konfirmasi pencairan. Petugas yang ditugaskan atau pemilik memilih **Buat kode pemasangan APK** pada detail kasus. Kode sekali pakai berlaku 24 jam.
2. Pasang `public/unduhan/ln-lokasi-demo-debug.apk`. Saat aplikasi pertama kali dibuka, masukkan URL server dan kode. Untuk emulator Android yang berjalan di komputer server demo, URL-nya `http://10.0.2.2:3000`. Ponsel fisik memerlukan URL HTTPS yang dapat diakses dari Internet atau jaringan yang sama.
3. Baca persetujuan, berikan izin lokasi saat aplikasi digunakan, lalu pilih **Izinkan sepanjang waktu** pada pengaturan Android. Setelah berhasil, layar utama kosong. Pemberitahuan Android menunjukkan layanan aktif dan menyediakan tindakan **Hentikan berbagi**.

Pemasangan kode tidak mengubah status finansial pinjaman. Server hanya mengeluarkan kode untuk pinjaman yang sudah aktif, menolak laporan tanpa persetujuan, membulatkan koordinat, membatasi peran yang dapat melihat lokasi, dan mencabut perangkat bila seluruh pinjaman nasabah lunas. APK menyimpan token perangkat terenkripsi memakai Android Keystore. Token tidak dimasukkan ke dalam APK atau repositori.

## Build

Butuh JDK 21 dan Android SDK 35 (`platforms;android-35`, `build-tools;35.0.0`, `platform-tools`). Dari folder ini:

```bash
./gradlew assembleDebug
```

Hasilnya di `app/build/outputs/apk/debug/app-debug.apk`. Gradle wrapper dikunci ke 8.11.1 dan SHA-256 distribusinya tercatat di `gradle/wrapper/gradle-wrapper.properties`. APK yang disalin ke `public/unduhan/` dibuat dari sumber yang sama. SHA-256 APK demo saat ini: `b141b31784d844a02f379914ef11fddad2f6ef7d7fb31c9c8b654eb2994c8acf`.

Pada lingkungan cloud ini, jalankan `bash scripts/setup-android-toolchain.sh` dari akar repositori, lalu `bash scripts/build-android-demo.sh`. Skrip setup memeriksa checksum arsip JDK dan Android SDK resmi, dan skrip build memakai Gradle wrapper dengan TLS serta CA proxy yang dikonfigurasi.

Build debug mengizinkan HTTP untuk emulator lokal. Build rilis menolak HTTP. Jangan membagikan APK debug, memakai kunci tanda tangan debug untuk rilis, atau memasukkan URL/token produksi ke dalam kode.

## Batasan

Android dapat menghentikan layanan saat aplikasi dipaksa berhenti, perangkat menghemat baterai, atau kebijakan sistem menolak memulai layanan lokasi saat boot. Penerima boot mencoba memulai kembali hanya jika persetujuan dan izin masih ada. Koneksi yang hilang menunda laporan; lokasi terbaru bukan bukti keberadaan. Belum ada geofence berbatas wilayah, deteksi spoofing, tes perangkat fisik, rilis bertanda tangan produksi, atau endpoint HTTPS publik. Penghentian berbagi saat offline baru dapat dikirim ke server ketika koneksi tersedia; data lama harus diperlakukan sebagai kedaluwarsa.
