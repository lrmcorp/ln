# Deploy demo di Tencent Lighthouse

Target yang diketahui: Ubuntu 24.04 dengan Docker 29, IP `43.152.240.47`, pengguna bawaan `ubuntu`. Ini **demo dengan data rekaan**. Jangan masukkan identitas, foto KTP, rekening, atau lokasi nasabah sungguhan.

## Hubungkan SSH ke GitHub Actions

1. Di Tencent Lighthouse, buka tab **SSH Keys**, buat kunci baru jika belum ada, lalu **Bind** ke instance ini. Simpan berkas kunci privat yang diunduh di tempat aman. Tencent mungkin meminta restart instance saat mengikat kunci.
2. Host key publik server sudah diambil melalui terminal Tencent dan disimpan di `deploy/known_hosts`. Jika VPS dibangun ulang, perbarui file itu dari konsol Tencent dengan:

   ```bash
   printf '43.152.240.47 '; sudo cat /etc/ssh/ssh_host_ed25519_key.pub
   ```

   Hasilnya berupa satu baris `43.152.240.47 ssh-ed25519 ...`. Ini **kunci publik server** untuk memverifikasi tujuan SSH; bukan kunci privat login.
3. Di pengaturan repo GitHub `lrmcorp/ln` → **Secrets and variables** → **Actions**, buat satu repository secret:
   - `VPS_SSH_KEY`: seluruh isi berkas kunci privat Tencent, termasuk baris awal/akhirnya.
4. Pastikan firewall Tencent mengizinkan koneksi SSH port 22 dari GitHub Actions dan port 80/443 untuk pengunjung. Di tab **Variables**, buat `VPS_DEPLOY_ENABLED=true`. Lalu jalankan workflow **Deploy demo to Tencent Lighthouse** melalui **Actions → Run workflow**. Setelah berhasil, setiap push ke `main` memicu validasi dan deploy otomatis.

Jangan kirim kunci privat atau kata sandi melalui chat atau commit. Workflow hanya memakai kunci dari GitHub Secret, memverifikasi host key, lalu menyalin commit yang diuji ke `~/ln` melalui SSH. Setelah layanan dimulai, workflow memeriksa pratinjau dari luar VPS agar aturan firewall dan proxy ikut teruji. Server membuat `.env.vps` sekali dengan izin berkas 0600 dan mempertahankannya pada deploy berikutnya. Database PostgreSQL tersimpan di volume Docker; deploy tidak menjalankan `down -v`.

## Akses sebelum ada domain

Proxy Caddy hanya membuka `http://43.152.240.47/pratinjau` beserta gambar dan berkas JavaScript/CSS yang diperlukan. Beranda, login, API, dan alur pinjaman mendapat HTTP 403. Ini mencegah pemakaian aplikasi melalui HTTP tanpa TLS. Lokasi browser dan APK Android memerlukan HTTPS sehingga belum dapat diuji dari IP ini.

## Subdomain demo HTTPS

Gunakan **hanya** `int.lnint.xyz` untuk aplikasi. Di DNSPod untuk `lnint.xyz`, buat record `A` dengan nama/host `int` dan nilai `43.152.240.47`. Jangan buat record `A` lain atau record `AAAA` untuk `int`. Domain utama `lnint.xyz` tidak dikonfigurasi di Caddy. Jika domain utama dan `www.lnint.xyz` sama-sama tidak boleh mengarah ke VPS, hapus record `A` dengan host `@` dan `www`; pertahankan record `NS` dan verifikasi `TXT`. Tab registrar **Custom DNS Host** membuat host nameserver, bukan record `A` untuk situs, dan tidak diperlukan di sini.

Pada setiap deploy, GitHub Actions memeriksa apakah `int.lnint.xyz` hanya teresolusi ke IP VPS. Sebelum DNS siap, pratinjau HTTP di IP tetap berjalan. Setelah DNS siap, workflow mengubah dua pengaturan nonrahasia dalam `.env.vps` di VPS (`CADDYFILE` dan `SITE_DOMAIN`), menjalankan ulang Caddy, lalu menguji `https://int.lnint.xyz/pratinjau` dengan validasi sertifikat TLS. Workflow **Activate demo HTTPS when DNS is ready** memeriksa DNS setiap 15 menit dan otomatis memicu deploy jika DNS sudah siap tetapi HTTPS belum sehat. Jadwal GitHub bisa terlambat dari waktu yang ditentukan. Port 80 dan 443 harus terbuka agar Caddy dapat memperoleh sertifikat.

Aplikasi pada subdomain masih **demo**, belum siap untuk pinjaman atau data nasabah nyata. HTTPS yang valid memungkinkan pengujian login per peran dan izin lokasi pada perangkat, tetapi tidak menghilangkan batasan produk dan keamanan yang dijelaskan di README utama.

Jika workflow gagal, lihat langkah yang gagal di GitHub Actions. Bila `sudo -n docker` gagal, periksa hak sudo pengguna `ubuntu` di konsol Tencent. Bila SSH gagal, periksa kunci yang di-bind, secret GitHub, dan aturan firewall. Jangan menonaktifkan pemeriksaan host key untuk memperbaiki koneksi.

## CowAgent di VPS yang sama

Konsol web CowAgent di-deploy dari repo `lrmcorp/lrmagents` ke `~/cowagent`. Caddy di stack ini meneruskan `https://agent.lnint.xyz` ke kontainer `cowagent:9899` melalui jaringan Docker bersama `lnint-edge`. Tambahkan record `A` dengan host `agent` ke `43.152.240.47` di DNSPod. Langkah secret dan variabel GitHub ada di README repo tersebut. Sebelum CowAgent berjalan, subdomain itu mengembalikan 502; `int.lnint.xyz` tidak terpengaruh.

Untuk memindahkan konsol ke `lrmcorporation.id`, buat record `A` untuk `@` dan `www` ke `43.152.240.47` di penyedia DNS domain itu. Lalu buat variabel repo `AGENT_DOMAIN=lrmcorporation.id,www.lrmcorporation.id` di `lrmcorp/ln` dan `lrmcorp/lrmagents`, dan jalankan ulang deploy keduanya. Hapus variabel itu untuk kembali ke `agent.lnint.xyz`.
