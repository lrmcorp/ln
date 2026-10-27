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

Saat domain sudah diarahkan ke IP server, ubah dua baris di `~/ln/.env.vps` melalui konsol server:

```text
CADDYFILE=./Caddyfile.domain
SITE_DOMAIN=nama-domain-anda.example
```

Jalankan ulang workflow agar Caddy meminta sertifikat HTTPS secara otomatis. Pastikan DNS dan port 80/443 sudah siap. Aplikasi yang terbuka dengan domain masih **demo**, belum siap untuk pinjaman atau data nasabah nyata.

Jika workflow gagal, lihat langkah yang gagal di GitHub Actions. Bila `sudo -n docker` gagal, periksa hak sudo pengguna `ubuntu` di konsol Tencent. Bila SSH gagal, periksa kunci yang di-bind, secret GitHub, dan aturan firewall. Jangan menonaktifkan pemeriksaan host key untuk memperbaiki koneksi.
