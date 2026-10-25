# LN Operasional

Repositori ini berisi tahap pertama demo platform pengelolaan pinjaman. Aplikasi ini **hanya untuk pengembangan**, bukan untuk data nasabah sungguhan, tanda tangan elektronik yang sah, atau transfer dana nyata.

## Jalankan secara lokal

Memerlukan Node.js 24 atau lebih baru, npm, dan Docker Compose.

```bash
npm ci
npm run env:init
# Kata sandi demo yang dibuat hanya disimpan di .env.local.
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm test
npm run build
npm run dev
```

Buka aplikasi pada port lokal yang ditampilkan Next.js. Akun demo adalah `owner@local.test`, `manager@local.test`, `officer@local.test`, dan `customer@local.test`. Gunakan kata sandi masing-masing dari `.env.local`. Nasabah contoh terhubung ke akun `customer@local.test`. Gunakan hanya data nasabah dan bank rekaan.

`.env.example` berisi contoh konfigurasi. Jika `.env.local` berasal dari versi lama, `npm run env:init` menambahkan kata sandi manajer demo tanpa mengganti kredensial lain. Jangan unggah `.env.local` ke Git. Pengaturan adaptor demo mengaktifkan simulasi tanda tangan dan konfirmasi bank. Tanpanya, kedua tindakan tersebut ditolak sampai layanan terverifikasi tersedia.

## Alur saat ini

Petugas menambahkan nasabah dan mengajukan pinjaman. Pemilik menyetujui pengajuan menurut versi kebijakan yang berlaku. Alur tanda tangan simulasi masih tersedia melalui API internal untuk pengujian, tetapi bukan bagian dari aplikasi nasabah. Pemilik mengizinkan pencairan, memulai transfer, mencatat bukti penyelesaian demo, memverifikasi pembayaran, dan menutup pinjaman lunas. Setiap perubahan status dilakukan dalam transaksi basis data dan dicatat untuk audit. Pencairan dan pembayaran menghasilkan jurnal yang seimbang.

**Aplikasi nasabah hanya untuk berbagi lokasi.** Nasabah dapat mulai atau berhenti membagikan perkiraan lokasi selama pinjaman aktif, melihat status izin perangkat, serta waktu laporan terakhir. Halaman harus tetap terbuka agar browser memperbarui lokasi; pelacakan latar belakang dan batas geofence belum tersedia. Hanya superadmin dan manajer cabang yang dapat melihat laporan terbaru di `/lokasi`. Petugas lapangan tidak dapat melihatnya. Penolakan izin tidak menghalangi alur pinjaman yang dioperasikan staf. Lokasi browser dapat dipalsukan dan belum layak dipakai sebagai bukti keberadaan.

Pemilik melihat saldo pokok dan bunga dari pembukuan, jumlah pengajuan, serta daftar pinjaman. Petugas hanya dapat melihat kasus yang ditugaskan. Antarmuka mendukung layar ponsel dan tidak memerlukan akun penyedia layanan eksternal.

## Pratinjau tampilan

- [Desktop pemilik](public/pratinjau/desktop-pemilik.png)
- [Ponsel pemilik](public/pratinjau/mobile-pemilik.png)
- [Ponsel petugas](public/pratinjau/mobile-petugas.png)
- [Ponsel nasabah: izin lokasi](public/pratinjau/mobile-nasabah.png)
- [Ponsel superadmin: pemantauan lokasi](public/pratinjau/mobile-superadmin-lokasi.png)
- [Ponsel manajer: pemantauan lokasi](public/pratinjau/mobile-manajer-lokasi.png)

Gambar juga dapat dibuka pada server lokal melalui `/pratinjau/mobile-nasabah.png` dan URL serupa untuk peran lain. Gambar diambil dari aplikasi lokal dengan data dan lokasi demo sintetis pada 25 Oktober 2026. Isi data demo dapat berubah setelah pengujian berikutnya.

## Dokumentasi

- [Catatan serah terima untuk agen berikutnya](handoff.md)
- [Arsitektur, model data, aturan, dan alur](docs/phase1.md)
- [API dan panduan menjalankan sistem](docs/runbook.md)

## Batas demo

Tahap ini mencakup satu alur demo dan sejumlah kegagalan penting. Unggah dan verifikasi dokumen identitas, aktivasi langsung nasabah, MFA pemilik, penyedia tanda tangan sah, integrasi bank, enkripsi kolom sensitif, pembatasan permintaan dengan Redis, geofence berbatas wilayah, pelacakan latar belakang, pengembalian dana, proses latar, cadangan data, dan aplikasi Flutter belum tersedia. Semua itu masih menjadi syarat sebelum penggunaan nyata. Lihat rencana dan matriks penerimaan di `docs/phase1.md`.
