'use client';
import {useEffect,useState} from 'react';
import type {MonitoredLocation} from '@/lib/location';

type Props={role:'owner'|'manager';name:string;initial:MonitoredLocation[]};
const time=(value:string|null)=>value?new Date(value).toLocaleString('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'medium'}):'Belum ada';
function status(item:MonitoredLocation,now:number){
  if(!item.enabled)return 'Izin tidak aktif';
  if(!item.reported_at)return 'Menunggu lokasi';
  return now-new Date(item.reported_at).getTime()<30000?'Baru diterima':'Laporan lama';
}

export default function LocationMonitor({role,name,initial}:Props){
  const [items,setItems]=useState(initial);
  const [error,setError]=useState('');
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{
    let stopped=false;
    const refresh=async()=>{
      try{
        const response=await fetch('/api/location',{cache:'no-store'});
        const result=await response.json();
        if(!response.ok)throw new Error(result.error??'Gagal memuat lokasi');
        if(!stopped){setItems(result);setError('');setNow(Date.now());}
      }catch(cause){if(!stopped)setError(cause instanceof Error?cause.message:'Gagal memuat lokasi');}
    };
    const timer=setInterval(refresh,5000);
    return()=>{stopped=true;clearInterval(timer);};
  },[]);
  async function signOut(){await fetch('/api/logout',{method:'POST'});window.location.replace('/');}
  return <main className="monitorPage"><header className="mast"><div className="brand">LN <span>Lokasi nasabah</span></div><div className="identity"><span>{name}<small>{role==='owner'?'Superadmin':'Manajer cabang'}</small></span><button className="textButton" onClick={signOut}>Keluar</button></div></header>
    <div className="monitorContent"><a className="monitorBack" href="/">{role==='owner'?'Kembali ke operasional':'Kembali ke pembayaran'}</a><div className="monitorIntro"><h1>Pemantauan lokasi</h1><p>Laporan terbaru dari nasabah yang mengizinkan berbagi lokasi pada pinjaman aktif. Halaman ini memeriksa pembaruan setiap 5 detik.</p></div>
      {error&&<p className="locationMessage error" role="alert">{error}</p>}
      {items.length===0?<div className="empty">Belum ada nasabah dengan pinjaman aktif dalam cakupan Anda.</div>:<div className="monitorList">{items.map(item=><article className="monitorCard" key={item.customer_id}><div><small>{status(item,now)}</small><h2>{item.customer_name==='Demo Borrower'?'Nasabah Demo':item.customer_name}</h2><p>Terakhir diterima: {time(item.reported_at)}</p></div><div className="monitorCoordinates">{item.enabled&&item.latitude!==null&&item.longitude!==null?<><strong>{item.latitude.toFixed(3)}, {item.longitude.toFixed(3)}</strong><span>Perkiraan ±{item.accuracy_m} m</span></>:<strong>Lokasi tidak tersedia</strong>}</div></article>)}</div>}
      <p className="monitorNote">Koordinat dibulatkan dan hanya laporan terbaru yang disimpan. Jika laporan berumur lebih dari 30 detik, anggap lokasinya tidak terkini. Petugas lapangan tidak dapat membuka data ini.</p>
    </div></main>;
}
