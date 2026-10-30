'use client';
import {useEffect,useState,useTransition,type ReactNode} from 'react';
import {Icon} from './icons';

export type StaffRole='owner'|'manager'|'officer';
export type StaffActor={id:string;name:string;role:StaffRole};

const roleLabels:Record<StaffRole,string>={owner:'Pemilik',officer:'Petugas',manager:'Manajer cabang'};
const demoNames:Record<string,string>={'Demo Owner':'Pemilik Demo','Demo Officer':'Petugas Demo','Demo Manager':'Manajer Demo','Demo Borrower':'Nasabah Demo'};
export const displayName=(name:string)=>demoNames[name]??name;
export const money=(value:string|number|null|undefined)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value??0));
export const shortDate=(value:string|null|undefined)=>value?new Date(value.length===10?`${value}T12:00:00Z`:value).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta',day:'numeric',month:'short',year:'numeric'}):'-';

type NavItem={key:string;href:string;label:string;icon:string;badge?:'late'|'verify'};
type NavGroup={title:string;items:NavItem[]};
const nav:Record<StaffRole,NavGroup[]>={
  owner:[{title:'Operasional',items:[{key:'beranda',href:'/',label:'Beranda',icon:'home'},{key:'tagihan',href:'/tagihan',label:'Tagihan',icon:'collect',badge:'late'},
      {key:'verifikasi',href:'/verifikasi',label:'Verifikasi',icon:'verify',badge:'verify'},{key:'lokasi',href:'/lokasi',label:'Lokasi nasabah',icon:'location'}]},
    {title:'Pinjaman',items:[{key:'pinjaman',href:'/pinjaman',label:'Daftar pinjaman',icon:'loans'}]},
    {title:'Keuangan',items:[{key:'laporan',href:'/laporan',label:'Laporan',icon:'report'},{key:'modal',href:'/modal',label:'Modal & investor',icon:'capital'}]},
    {title:'Pengaturan',items:[{key:'kebijakan',href:'/kebijakan',label:'Kebijakan pinjaman',icon:'policy'},{key:'admin',href:'/admin',label:'Cabang & pengguna',icon:'users'}]}],
  manager:[{title:'Operasional',items:[{key:'beranda',href:'/',label:'Beranda',icon:'home'},{key:'tagihan',href:'/tagihan',label:'Tagihan',icon:'collect',badge:'late'},
      {key:'verifikasi',href:'/verifikasi',label:'Verifikasi',icon:'verify',badge:'verify'},{key:'lokasi',href:'/lokasi',label:'Lokasi nasabah',icon:'location'}]},
    {title:'Pinjaman',items:[{key:'pinjaman',href:'/pinjaman',label:'Daftar pinjaman',icon:'loans'},{key:'pengajuan',href:'/pengajuan/baru',label:'Pengajuan baru',icon:'intake'}]},
    {title:'Keuangan',items:[{key:'laporan',href:'/laporan',label:'Laporan',icon:'report'}]}],
  officer:[{title:'Hari ini',items:[{key:'tagihan',href:'/tagihan',label:'Tagihan',icon:'collect',badge:'late'},{key:'setoran',href:'/setoran',label:'Setoran kas',icon:'deposit'}]},
    {title:'Pinjaman',items:[{key:'pinjaman',href:'/pinjaman',label:'Daftar pinjaman',icon:'loans'},{key:'pengajuan',href:'/pengajuan/baru',label:'Pengajuan baru',icon:'intake'}]}]
};
const titles:Record<string,string>={beranda:'Beranda',tagihan:'Tagihan',verifikasi:'Verifikasi',lokasi:'Lokasi nasabah',pinjaman:'Daftar pinjaman',laporan:'Laporan',
  modal:'Modal & investor',kebijakan:'Kebijakan pinjaman',admin:'Cabang & pengguna',setoran:'Setoran kas',pengajuan:'Pengajuan baru'};
const shortLabels:Record<string,string>={setoran:'Setoran',pinjaman:'Pinjaman',pengajuan:'Pengajuan'};
type NavData={badges:{late:number;verify:number};branches:{id:string;name:string}[]};

function Clock(){
  const [now,setNow]=useState('');
  useEffect(()=>{
    const tick=()=>setNow(new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit'}).format(new Date())+' WIB');
    tick();const timer=setInterval(tick,30000);return()=>clearInterval(timer);
  },[]);
  return now?<span className="clock">{now}</span>:null;
}

function BranchPicker({branches}:{branches:NavData['branches']}){
  const [value,setValue]=useState('');
  useEffect(()=>{setValue(new URLSearchParams(window.location.search).get('cabang')??'');},[]);
  if(branches.length<2)return null;
  return <select className="branchPicker" aria-label="Pilih cabang" value={value} onChange={e=>{
    const url=new URL(window.location.href);
    if(e.target.value)url.searchParams.set('cabang',e.target.value);else url.searchParams.delete('cabang');
    window.location.assign(url.pathname+url.search);}}>
    <option value="">Semua cabang</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>;
}

export function Shell({actor,active,children}:{actor:StaffActor;active:string;children:ReactNode}){
  const groups=nav[actor.role];
  const [drawer,setDrawer]=useState(false);
  const [data,setData]=useState<NavData|null>(null);
  useEffect(()=>{fetch('/api/nav',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(setData).catch(()=>setData(null));},[]);
  async function signOut(){await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});window.location.assign('/');}
  const group=groups.find(g=>g.items.some(item=>item.key===active))?.title??'Operasional';
  const sidebar=<nav className="sideNav" aria-label="Menu utama">{groups.map(g=><div key={g.title} className="navGroup"><span className="navTitle">{g.title}</span>
    {g.items.map(item=>{const count=item.badge?data?.badges[item.badge]??0:0;
      return <a key={item.key} href={item.href} aria-current={item.key===active?'page':undefined}><Icon name={item.icon}/><span>{item.label}</span>{count>0&&<span className={`navBadge ${item.badge==='late'?'warn':''}`} aria-label={`${count} perlu perhatian`}>{count}</span>}</a>;})}</div>)}</nav>;
  const profile=<div className="sideProfile"><div><strong>{displayName(actor.name)}</strong><small>{roleLabels[actor.role]}</small></div><button className="iconButton" onClick={signOut} aria-label="Keluar" title="Keluar"><Icon name="logout"/></button></div>;
  return <div className={`app role-${actor.role}`} id="top">
    <aside className="sidebar"><a className="logo" href="/">LN <span>Operasional</span></a>{sidebar}{profile}</aside>
    {drawer&&<div className="drawerBackdrop" onClick={()=>setDrawer(false)}><aside className="sidebar drawer" onClick={e=>e.stopPropagation()}><div className="drawerHead"><a className="logo" href="/">LN <span>Operasional</span></a><button className="iconButton" onClick={()=>setDrawer(false)} aria-label="Tutup menu"><Icon name="close"/></button></div>{sidebar}{profile}</aside></div>}
    <div className="main">
      <header className="topbar"><button className="iconButton menuButton" onClick={()=>setDrawer(true)} aria-label="Buka menu"><Icon name="menu"/></button>
        <nav className="crumbs" aria-label="Lokasi halaman"><span>{group}</span><span aria-hidden="true">/</span><strong>{titles[active]??active}</strong></nav>
        <div className="topTools">{actor.role==='owner'&&data&&<BranchPicker branches={data.branches}/>}<Clock/></div></header>
      <main className="page">{children}</main>
    </div>
    {actor.role==='officer'&&<nav className="bottomNav" aria-label="Menu petugas">{groups.flatMap(g=>g.items).map(item=><a key={item.key} href={item.href} aria-current={item.key===active?'page':undefined}><Icon name={item.icon}/><span>{shortLabels[item.key]??item.label}</span></a>)}</nav>}
  </div>;
}

// Page title row: greeting or title, one line of context, and at most two actions (secondary, then primary).
export function PageHeader({title,subtitle,actions}:{title:string;subtitle?:ReactNode;actions?:ReactNode}){
  return <div className="pageHeader"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{actions&&<div className="pageActions">{actions}</div>}</div>;
}

// Posts JSON or FormData, then reloads to the given hash so server-rendered data refreshes.
export function useAction(){
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  type Options={hash?:string;success?:string;onDone?:(result:any)=>void};
  // Several requests in order as one user action; stops at the first failure and reloads so the page shows where it stopped.
  function chain(steps:{path:string;body:unknown}[],options:Options={}){
    setError('');setMessage('');
    startTransition(async()=>{
      let result:any=null;
      try{
        for(const step of steps){
          const response=step.body instanceof FormData?await fetch(step.path,{method:'POST',body:step.body}):await fetch(step.path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(step.body)});
          result=await response.json();
          if(!response.ok)throw new Error(result.error??'Permintaan gagal');
        }
        if(options.onDone){options.onDone(result);return;}
        setMessage(options.success??'Tersimpan. Memperbarui halaman…');
        if(options.hash!==undefined)window.location.hash=options.hash;
        window.location.reload();
      }catch(cause){setError(cause instanceof Error?cause.message:'Permintaan gagal');}
    });
  }
  const run=(path:string,body:unknown,options:Options={})=>chain([{path,body}],options);
  const feedback=<>{pending&&<div className="feedback" role="status">Mohon tunggu…</div>}{error&&<div className="feedback error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Tutup pesan kesalahan">Tutup</button></div>}{message&&!pending&&<div className="feedback" role="status">{message}</div>}</>;
  return {pending,error,message,setMessage,run,chain,feedback};
}

export function StatusChip({tone,children}:{tone:'late'|'due'|'ok'|'neutral'|'pending';children:ReactNode}){
  return <span className={`chip chip-${tone}`}>{children}</span>;
}
