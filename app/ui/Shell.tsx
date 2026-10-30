'use client';
import {useState,useTransition,type ReactNode} from 'react';

export type StaffRole='owner'|'manager'|'officer';
export type StaffActor={id:string;name:string;role:StaffRole};

const roleLabels:Record<StaffRole,string>={owner:'Pemilik',officer:'Petugas',manager:'Manajer cabang'};
const demoNames:Record<string,string>={'Demo Owner':'Pemilik Demo','Demo Officer':'Petugas Demo','Demo Manager':'Manajer Demo','Demo Borrower':'Nasabah Demo'};
export const displayName=(name:string)=>demoNames[name]??name;
export const money=(value:string|number|null|undefined)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value??0));
export const shortDate=(value:string|null|undefined)=>value?new Date(value.length===10?`${value}T12:00:00Z`:value).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta',day:'numeric',month:'short',year:'numeric'}):'-';

type NavItem={key:string;href:string;label:string};
const nav:Record<StaffRole,NavItem[]>={
  owner:[{key:'pinjaman',href:'/',label:'Pinjaman'},{key:'laporan',href:'/laporan',label:'Laporan'},{key:'verifikasi',href:'/verifikasi',label:'Verifikasi'},
    {key:'tagihan',href:'/tagihan',label:'Tagihan'},{key:'modal',href:'/modal',label:'Modal'},{key:'admin',href:'/admin',label:'Cabang & pengguna'},{key:'lokasi',href:'/lokasi',label:'Lokasi'}],
  manager:[{key:'pinjaman',href:'/',label:'Pinjaman'},{key:'verifikasi',href:'/verifikasi',label:'Verifikasi'},{key:'tagihan',href:'/tagihan',label:'Tagihan'},
    {key:'laporan',href:'/laporan',label:'Laporan'},{key:'lokasi',href:'/lokasi',label:'Lokasi'}],
  officer:[{key:'tagihan',href:'/tagihan',label:'Tagihan'},{key:'pinjaman',href:'/pinjaman',label:'Pinjaman'},{key:'pengajuan',href:'/pengajuan/baru',label:'Pengajuan'},{key:'setoran',href:'/setoran',label:'Setoran'}]
};

export function Shell({actor,active,children}:{actor:StaffActor;active:string;children:ReactNode}){
  const items=nav[actor.role];
  async function signOut(){await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});window.location.assign('/');}
  return <main className={`shell role-${actor.role}`} id="top"><header className="mast"><div className="brand">LN <span>Operasional</span></div><div className="identity"><span>{displayName(actor.name)}<small>{roleLabels[actor.role]}</small></span><button className="textButton" onClick={signOut}>Keluar</button></div></header>
    <div className="workspace"><nav className="rail" aria-label="Menu utama"><span className="railTitle">Ruang kerja</span>{items.map(item=><a key={item.key} href={item.href} aria-current={item.key===active?'page':undefined}>{item.label}</a>)}<div className="railFoot">Hanya untuk pengembangan<br/>Layanan penyedia disimulasikan</div></nav>
      <div className="content">{children}</div></div>
    {actor.role==='officer'&&<nav className="bottomNav" aria-label="Menu petugas">{items.map(item=><a key={item.key} href={item.href} aria-current={item.key===active?'page':undefined}>{item.label}</a>)}</nav>}
  </main>;
}

// Posts JSON or FormData, then reloads to the given hash so server-rendered data refreshes.
export function useAction(){
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  function run(path:string,body:unknown,options:{hash?:string;success?:string;onDone?:(result:any)=>void}={}){
    setError('');setMessage('');
    startTransition(async()=>{
      try{
        const response=body instanceof FormData?await fetch(path,{method:'POST',body}):await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const result=await response.json();
        if(!response.ok)throw new Error(result.error??'Permintaan gagal');
        if(options.onDone){options.onDone(result);return;}
        setMessage(options.success??'Tersimpan. Memperbarui halaman…');
        if(options.hash!==undefined)window.location.hash=options.hash;
        window.location.reload();
      }catch(cause){setError(cause instanceof Error?cause.message:'Permintaan gagal');}
    });
  }
  const feedback=<>{pending&&<div className="feedback" role="status">Mohon tunggu…</div>}{error&&<div className="feedback error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Tutup pesan kesalahan">Tutup</button></div>}{message&&!pending&&<div className="feedback" role="status">{message}</div>}</>;
  return {pending,error,message,setMessage,run,feedback};
}

export function StatusChip({tone,children}:{tone:'late'|'due'|'ok'|'neutral'|'pending';children:ReactNode}){
  return <span className={`chip chip-${tone}`}>{children}</span>;
}
