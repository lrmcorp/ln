'use client';
import {useEffect,useRef,useState} from 'react';
import type {LocationState} from '@/lib/location';

type Props={name:string;initial:LocationState};
const time=(value:string|null)=>value?new Date(value).toLocaleString('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'short'}):'Belum ada';

export default function LocationApp({name,initial}:Props){
  const [location,setLocation]=useState(initial);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [deviceStatus,setDeviceStatus]=useState('');
  const lastReport=useRef(0);
  const lastCoordinates=useRef('');
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);},[]);
  const fresh=location.reported_at&&now-new Date(location.reported_at).getTime()<30000;
  const status=!location.active?'Tidak ada pinjaman aktif':!location.enabled?'Berbagi lokasi mati':fresh?'Lokasi sedang dibagikan':location.reported_at?'Pembaruan lokasi tertunda':'Menunggu lokasi perangkat';

  async function consent(enabled:boolean){
    setBusy(true);setError('');setDeviceStatus('');
    try{
      const response=await fetch('/api/location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'consent',enabled})});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error??'Gagal mengubah izin');
      lastReport.current=0;
      lastCoordinates.current='';
      setLocation(previous=>({...previous,enabled,consented_at:enabled?result.consented_at:previous.consented_at,stopped_at:enabled?null:result.stopped_at,latitude:null,longitude:null,accuracy_m:null,reported_at:null}));
    }catch(cause){setError(cause instanceof Error?cause.message:'Gagal mengubah izin');}
    finally{setBusy(false);}
  }

  useEffect(()=>{
    if(!location.active||!location.enabled) return;
    if(!navigator.geolocation){setDeviceStatus('Perangkat ini tidak menyediakan lokasi.');return;}
    let stopped=false;
    const report=(position:GeolocationPosition)=>{
      if(stopped) return;
      const coordinateKey=`${Math.round(position.coords.latitude*1000)},${Math.round(position.coords.longitude*1000)}`;
      if(coordinateKey===lastCoordinates.current&&Date.now()-lastReport.current<10000) return;
      lastReport.current=Date.now();
      lastCoordinates.current=coordinateKey;
      fetch('/api/location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'report',latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy})})
        .then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error??'Laporan lokasi gagal');return result;})
        .then(result=>{if(!stopped){setLocation(previous=>({...previous,latitude:result.latitude,longitude:result.longitude,accuracy_m:result.accuracy_m,reported_at:result.reported_at}));setDeviceStatus('');}})
        .catch(cause=>{if(!stopped)setDeviceStatus(cause instanceof Error?cause.message:'Laporan lokasi gagal');});
    };
    const failed=(cause:GeolocationPositionError)=>{
      if(stopped)return;
      setDeviceStatus(cause.code===1?'Izin lokasi perangkat ditolak. Ubah izin di pengaturan browser.':'Lokasi perangkat belum tersedia. Coba lagi saat sinyal membaik.');
    };
    const options:PositionOptions={enableHighAccuracy:false,maximumAge:10000,timeout:15000};
    const watcher=navigator.geolocation.watchPosition(report,failed,options);
    const interval=setInterval(()=>navigator.geolocation.getCurrentPosition(report,failed,options),15000);
    return ()=>{stopped=true;navigator.geolocation.clearWatch(watcher);clearInterval(interval);};
  },[location.active,location.enabled]);

  async function signOut(){await fetch('/api/logout',{method:'POST'});window.location.reload();}

  return <main className="locationApp"><header className="locationHeader"><span className="brand">LN <span>Lokasi</span></span><button className="textButton" onClick={signOut}>Keluar</button></header>
    <div className="locationContent"><div className="locationIntro"><small>Nasabah · {name}</small><h1>Lokasi saya</h1><p>Anda mengendalikan kapan lokasi dibagikan.</p></div>
      <section className="locationPrimary" aria-labelledby="location-status"><small>Status berbagi lokasi</small><h2 id="location-status" aria-live="polite">{status}</h2><p>{location.active?'Lokasi diperbarui selama halaman ini terbuka, perangkat mengizinkan, dan jaringan tersedia.':'Berbagi lokasi hanya tersedia selama pinjaman aktif.'}</p>
        {location.active&&(location.enabled?<button disabled={busy} onClick={()=>consent(false)}>Berhenti berbagi lokasi</button>:<button disabled={busy} onClick={()=>consent(true)}>Mulai berbagi lokasi</button>)}
      </section>
      <section className="locationDetails" aria-label="Rincian izin lokasi"><div><small>Laporan terakhir</small><strong>{time(location.reported_at)}</strong></div><div><small>Ketelitian laporan</small><strong>{location.accuracy_m===null?'Belum ada':`Sekitar ${location.accuracy_m} meter`}</strong></div><div><small>Yang dapat melihat</small><strong>Superadmin dan manajer cabang</strong></div><div><small>Petugas lapangan</small><strong>Tidak memiliki akses</strong></div></section>
      <section className="locationPrivacy"><h2>Tentang izin Anda</h2><p>Hanya perkiraan lokasi terbaru yang disimpan. Koordinat dibulatkan hingga sekitar 100 meter. Kami tidak menyimpan riwayat perjalanan. Anda dapat berhenti berbagi kapan saja; pembagian juga berhenti ketika pinjaman lunas.</p><p>Izin ini terpisah dari perjanjian pinjaman. Menolak berbagi lokasi tidak mengubah kewajiban pembayaran Anda.</p></section>
      {deviceStatus&&<p className="locationMessage" role="status">{deviceStatus}</p>}{error&&<p className="locationMessage error" role="alert">{error}</p>}
    </div></main>;
}
