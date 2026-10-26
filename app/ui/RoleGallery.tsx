'use client';
import {useState} from 'react';
import Image from 'next/image';

type Role='owner'|'manager'|'officer'|'customer';
type Shot={title:string;src:string;width:number;height:number;note:string};
type RoleDetail={id:Role;label:string;scope:string;intro:string;access:string[];shots:Shot[]};
const roles:RoleDetail[]=[
  {id:'owner',label:'Pemilik',scope:'Seluruh cabang',intro:'Memutuskan pengajuan dan mengendalikan pinjaman setelah tanda tangan nasabah.',
    access:['Tinjau bukti KTP dan video, lalu setujui syarat yang ditandatangani.','Atur kebijakan, izinkan pencairan, catat transfer dan pembayaran.','Lihat lokasi nasabah yang aktif dan sudah memberi izin.'],
    shots:[{title:'Ruang kerja',src:'/pratinjau/desktop-pemilik.png',width:1440,height:900,note:'Ringkasan dan daftar pinjaman.'},
      {title:'Akses ponsel',src:'/pratinjau/mobile-pemilik.png',width:390,height:844,note:'Keputusan kasus dalam tampilan ringkas.'},
      {title:'Pemantauan lokasi',src:'/pratinjau/mobile-superadmin-lokasi.png',width:390,height:844,note:'Hanya laporan terbaru dari nasabah yang mengizinkan.'}]},
  {id:'manager',label:'Manajer',scope:'Cabang sendiri',intro:'Memantau lokasi terbaru nasabah aktif di cabangnya.',
    access:['Lihat laporan lokasi dalam cakupan cabang sendiri.','Lihat waktu laporan dan penanda data yang mulai usang.','Tidak dapat melihat lokasi dari cabang lain atau mengubah pinjaman.'],
    shots:[{title:'Pemantauan cabang',src:'/pratinjau/mobile-manajer-lokasi.png',width:390,height:844,note:'Koordinat perkiraan dan waktu pembaruan.'}]},
  {id:'officer',label:'Petugas',scope:'Kasus yang ditugaskan',intro:'Membuat pengajuan dan menyerahkan layar tanda tangan kepada nasabah.',
    access:['Isi identitas, foto KTP, dan video tantangan.','Perlihatkan jumlah, angsuran tanggal 1, dan syarat berbahasa Indonesia.','Nasabah menandatangani pada perangkat petugas; petugas tidak bisa melihat lokasi.'],
    shots:[{title:'Daftar tugas',src:'/pratinjau/mobile-petugas.png',width:390,height:844,note:'Hanya kasus yang ditugaskan.'},
      {title:'Langkah 1 · Data',src:'/pratinjau/mobile-pengajuan-petugas.png',width:390,height:2126,note:'Identitas, rekening, dan bukti.'},
      {title:'Langkah 2 · Jadwal',src:'/pratinjau/mobile-jadwal-petugas.png',width:390,height:1280,note:'Pokok, bunga, dan cicilan bulanan.'},
      {title:'Langkah 3 · Tanda tangan',src:'/pratinjau/mobile-tanda-tangan.png',width:390,height:2754,note:'Nasabah membaca syarat sebelum persetujuan pemilik.'}]},
  {id:'customer',label:'Nasabah',scope:'Perangkat sendiri',intro:'Beranda sengaja kosong. Izin lokasi diatur pada halaman terpisah.',
    access:['Beranda web tidak menampilkan dashboard pinjaman.','Nasabah dapat memberi atau mencabut izin di halaman khusus.','APK Android demo dapat melapor saat browser ditutup setelah izin sepanjang waktu diberikan.'],
    shots:[{title:'Beranda kosong',src:'/pratinjau/mobile-nasabah.png',width:390,height:844,note:'Tidak ada kontrol yang mengganggu.'},
      {title:'Izin lokasi',src:'/pratinjau/mobile-nasabah-izin-lokasi.png',width:390,height:844,note:'Persetujuan dan pencabutan tetap tersedia.'}]}
];

export default function RoleGallery(){
  const [selected,setSelected]=useState<Role>('owner');
  const role=roles.find(item=>item.id===selected)!;
  return <main className="rolePreview"><header className="rolePreviewHeader"><div className="brand">LN <span>Operasional</span></div><a href="/">Buka aplikasi langsung</a></header>
    <section className="rolePreviewIntro"><small>PRATINJAU AKSES · DATA REKAAN</small><h1>Satu sistem, empat akses.</h1><p>Pilih peran untuk melihat layar dan batas aksesnya. Gambar di bawah adalah cuplikan demo; aplikasi langsung tetap meminta login.</p></section>
    <nav className="rolePreviewTabs" aria-label="Pilih akses peran">{roles.map(item=><button key={item.id} type="button" aria-pressed={selected===item.id} onClick={()=>setSelected(item.id)}>{item.label}<small>{item.scope}</small></button>)}</nav>
    <section className="rolePreviewRole" aria-live="polite"><div className="rolePreviewSummary"><div><small>AKSES {role.label.toLocaleUpperCase('id-ID')}</small><h2>{role.intro}</h2></div><ul>{role.access.map(item=><li key={item}>{item}</li>)}</ul></div>
      <div className="rolePreviewShots">{role.shots.map(shot=><figure key={shot.src} className={shot.width>shot.height?'wide':''}><div className="rolePreviewImage"><Image src={shot.src} alt={`${role.label}: ${shot.title}`} width={shot.width} height={shot.height} loading="eager" unoptimized/></div><figcaption><strong>{shot.title}</strong><span>{shot.note}</span><a href={shot.src} target="_blank" rel="noopener noreferrer">Buka ukuran penuh</a></figcaption></figure>)}</div>
    </section>
    <footer className="rolePreviewFooter"><p>Ini pratinjau visual dengan data rekaan. Untuk mencoba transaksi demo, buka aplikasi langsung dan masuk dengan akun peran yang sesuai.</p><a href="/unduhan/ln-lokasi-demo-debug.apk">Unduh APK nasabah demo</a></footer>
  </main>;
}
