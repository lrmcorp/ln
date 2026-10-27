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

`.env.example` berisi contoh konfigurasi. Jika `.env.local` berasal dari versi lama, `npm run env:init` menambahkan kata sandi manajer dan kunci enkripsi demo tanpa mengganti kredensial lain. Jangan unggah `.env.local` ke Git. Simpan cadangan kunci enkripsi secara aman; kehilangan kunci membuat bukti lama tidak dapat dibaca. Pengaturan adaptor demo mengaktifkan simulasi tanda tangan dan konfirmasi bank. Tanpanya, kedua tindakan tersebut ditolak sampai layanan terverifikasi tersedia.

## Alur saat ini

Petugas membuka **Pengajuan baru** dan melalui tiga langkah di ponsel: (1) identitas, foto KTP, video tantangan wajah, dan rekening; (2) jumlah serta jadwal cicilan; (3) nasabah membaca syarat berbahasa Indonesia dan menggambar tanda tangan pada perangkat petugas. Halaman tanda tangan khusus juga bisa dibuka oleh akun nasabah yang sudah terhubung ke pengajuan; nasabah baru belum otomatis menerima akun atau tautan aman ke ponsel sendiri. Beranda aplikasi nasabah tampil kosong.

Cicilan dibayar **setiap minggu**. Angsuran pertama jatuh tempo 7 hari setelah pemilik menyetujui pinjaman, lalu setiap 7 hari. Bunga tetap ditambahkan di atas pokok sesuai tenor yang dipilih petugas dari tabel kebijakan pemilik: bawaan 4 minggu 20%, 5 minggu 25%, 6 minggu 30%. Contoh: pokok Rp500.000 selama 5 minggu dengan bunga 25% menjadi total Rp625.000, atau Rp125.000 per minggu. Pemilik dapat mengubah persentase, menambah, atau menghapus tenor di **Kebijakan pinjaman**; perubahan berlaku untuk pengajuan berikutnya. Syarat juga mencantumkan denda sederhana 5% per bulan dari pokok awal (dapat diubah pemilik), dihitung harian dengan pembagi 30. **Denda baru dicantumkan dalam syarat; penagihan, jurnal, dan alokasi denda belum tersedia.**

Setiap kali nasabah membayar, **manajer cabang** (atau pemilik) membuka pinjaman, mengunggah foto atau PDF bukti pembayaran, dan menyimpan jumlahnya. Jumlah angsuran berikutnya terisi otomatis. Kartu pinjaman lalu menampilkan, misalnya, "Rp100.000 dari Rp625.000 dibayar · sisa Rp525.000", status tiap minggu (lunas, sebagian, belum jatuh tempo, terlambat), dan riwayat pembayaran dengan tautan bukti. Bukti tersimpan terenkripsi; hanya pemilik dan manajer cabang yang sama yang dapat membukanya. Bukti yang sama tidak dapat dicatat dua kali.

Nasabah menandatangani sebelum persetujuan pemilik. Pemilik meninjau foto dan video secara manual, lalu hanya dapat menyetujui versi syarat yang sama dengan yang ditandatangani. Perubahan jumlah, bunga, tenor, atau ketentuan sesudah itu memerlukan versi dan tanda tangan baru; layar perubahan versi belum tersedia. Pemilik kemudian mengizinkan pencairan, memulai transfer, mencatat bukti penyelesaian demo, dan menutup pinjaman lunas. Pembayaran mingguan dicatat manajer cabang atau pemilik beserta buktinya. Setiap perubahan status dilakukan dalam transaksi basis data dan dicatat untuk audit. Pencairan dan pembayaran menghasilkan jurnal yang seimbang.

**Beranda nasabah kosong.** Bila nasabah telah memberi izin berbagi lokasi, halaman tetap menjalankan pelaporan lokasi selama pinjaman aktif, halaman terbuka, perangkat mengizinkan, dan jaringan tersedia. Untuk memberi atau mencabut izin secara sadar, nasabah membuka halaman terpisah `/izin-lokasi`; penolakan sebelumnya tidak diaktifkan ulang otomatis. Penolakan izin perangkat juga menghentikan persetujuan di server dan menghapus koordinat terakhir. Menutup halaman atau membiarkan browser menghentikannya dapat menghentikan pembaruan: pelacakan latar belakang perangkat dan batas geofence belum tersedia. Hanya superadmin dan manajer cabang yang dapat melihat laporan terbaru di `/lokasi`. Beranda manajer kini menampilkan pembayaran cabang, dengan tautan ke pemantauan lokasi. Petugas lapangan tidak dapat melihatnya. Penolakan izin tidak menghalangi alur pinjaman yang dioperasikan staf. Lokasi browser dapat dipalsukan dan belum layak dipakai sebagai bukti keberadaan.

## APK Android nasabah (demo)

[Unduh APK demo Android](public/unduhan/ln-lokasi-demo-debug.apk). APK ini memakai tanda tangan debug dan **hanya untuk pengujian dengan data rekaan**. Sumber dan cara build ada di [android-customer/README.md](android-customer/README.md).

1. Setelah pemilik mengonfirmasi pencairan sehingga status pinjaman **Aktif**, petugas atau pemilik membuka detail pinjaman dan memilih **Buat kode pemasangan APK**. Kode berlaku 24 jam dan hanya dapat digunakan sekali.
2. Nasabah memasang APK, membuka aplikasi sekali, memasukkan alamat server dan kode tersebut, lalu menyetujui berbagi lokasi serta memberikan izin lokasi Android **sepanjang waktu**. Android meminta izin setelah aplikasi dibuka, bukan selama proses instalasi.
3. Layar utama kemudian kosong. Layanan lokasi Android tetap berjalan saat layar aplikasi ditutup, dengan pemberitahuan yang dapat dipakai untuk menghentikan berbagi. Server hanya menerima laporan selama pinjaman aktif dan izin masih berlaku; ketika seluruh pinjaman nasabah lunas, token perangkat dicabut dan lokasi terakhir dihapus.

Pada emulator Android, APK debug dapat memakai `http://10.0.2.2:3000` jika server Next.js berjalan di komputer emulator. Pada ponsel fisik, gunakan alamat **HTTPS publik yang dapat dijangkau ponsel**. Server `localhost` tidak dapat diakses langsung dari ponsel. Android dapat menghentikan layanan karena penghematan baterai, paksa berhenti, atau pembatasan perangkat; ini belum menjamin pelacakan tanpa putus dan belum mendeteksi batas wilayah geofence.

Pemilik melihat saldo pokok dan bunga dari pembukuan, jumlah pengajuan, serta daftar pinjaman. Petugas hanya dapat melihat kasus yang ditugaskan. Antarmuka mendukung layar ponsel dan tidak memerlukan akun penyedia layanan eksternal.

## Pratinjau tampilan

Buka `/pratinjau` pada server lokal untuk memilih akses Pemilik, Manajer, Petugas, atau Nasabah dalam satu halaman. Cuplikannya memakai data rekaan dan bersifat statis; gunakan login aplikasi untuk mencoba alur yang aktif.

[Mockup empat akses](public/pratinjau/mockup-empat-akses.png) merangkum tampilan ponsel dalam satu gambar ilustratif. Layar nasabah sengaja kosong. Untuk teks dan detail yang akurat, gunakan cuplikan asli di bawah atau halaman `/pratinjau`.

- [Desktop pemilik](public/pratinjau/desktop-pemilik.png)
- [Ponsel pemilik](public/pratinjau/mobile-pemilik.png)
- [Ponsel petugas](public/pratinjau/mobile-petugas.png)
- [Ponsel petugas: data pengajuan](public/pratinjau/mobile-pengajuan-petugas.png)
- [Ponsel petugas: jadwal bulanan](public/pratinjau/mobile-jadwal-petugas.png)
- [Ponsel nasabah pada perangkat petugas: syarat dan tanda tangan](public/pratinjau/mobile-tanda-tangan.png)
- [Ponsel nasabah: beranda kosong](public/pratinjau/mobile-nasabah.png)
- [Ponsel nasabah: izin lokasi terpisah](public/pratinjau/mobile-nasabah-izin-lokasi.png)
- [Ponsel superadmin: pemantauan lokasi](public/pratinjau/mobile-superadmin-lokasi.png)
- [Ponsel manajer: pemantauan lokasi](public/pratinjau/mobile-manajer-lokasi.png)

Gambar juga dapat dibuka pada server lokal melalui `/pratinjau/mobile-nasabah.png` dan URL serupa untuk peran lain. Gambar diambil dari aplikasi lokal dengan data dan lokasi demo sintetis pada 25 Oktober 2026. Isi data demo dapat berubah setelah pengujian berikutnya.

## Dokumentasi

- [Catatan serah terima untuk agen berikutnya](handoff.md)
- [Deploy demo ke Tencent Lighthouse](deploy/README.md)
- [Arsitektur, model data, aturan, dan alur](docs/phase1.md)
- [API dan panduan menjalankan sistem](docs/runbook.md)

## Batas demo

Tahap ini mencakup alur demo dan sejumlah kegagalan penting. Foto KTP, video, rincian identitas tambahan, dan gambar tanda tangan tersimpan terenkripsi, tetapi video belum membuktikan liveness secara otomatis. APK Android memiliki layanan lokasi latar belakang demo, tetapi belum diuji pada perangkat fisik dan belum menjamin pembaruan terus-menerus. MFA pemilik, penyedia tanda tangan sah, integrasi bank, penagihan denda dan pembayaran tertunggak, perlindungan semua kolom sensitif, pembatasan permintaan dengan Redis, geofence berbatas wilayah, pengembalian dana, proses latar, cadangan data, dan aplikasi Flutter belum tersedia. Semua itu masih menjadi syarat sebelum penggunaan nyata. Lihat rencana dan matriks penerimaan di `docs/phase1.md`.
