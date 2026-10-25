'use client';
import {useEffect,useState,useTransition} from 'react';

type Actor={id:string;name:string;email:string;role:'owner'|'officer'};
type Application={id:string;status:string;requested_principal:string;approved_principal:string|null;interest_amount:string|null;term_weeks:number;customer_name:string;officer_name:string;submitted_at:string;snapshot:any;snapshot_hash:string|null;signed_at:string|null;paid:string;transfer_reference:string|null};
type Data={applications:Application[];customers:{id:string;name:string}[];totals:{net_cash:string;principal_outstanding:string;interest_receivable:string}|null;policy:{version:number;min_principal:string;max_principal:string;flat_interest_bps:number;min_weeks:number;max_weeks:number}|null;counts:{pending:number;active:number}|null};
const money=(value:string|number|null|undefined)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value??0));
const labels:Record<string,string>={submitted:'Menunggu keputusan',approved:'Disetujui',signed:'Perjanjian ditandatangani',release_authorized:'Pencairan diizinkan',transfer_initiated:'Transfer dimulai',active:'Aktif',paid_off:'Lunas',closed:'Ditutup'};
const ownerSteps:Record<string,string>={submitted:'Putuskan pengajuan',signed:'Izinkan pencairan',release_authorized:'Mulai transfer',transfer_initiated:'Konfirmasi transfer',active:'Catat pembayaran',paid_off:'Tutup pinjaman'};
const roleLabels:Record<Actor['role'],string>={owner:'Pemilik',officer:'Petugas'};
const demoNames:Record<string,string>={'Demo Owner':'Pemilik Demo','Demo Officer':'Petugas Demo','Demo Borrower':'Nasabah Demo'};
const displayName=(name:string)=>demoNames[name]??name;
function nextStep(role:Actor['role'],status:string){
  if(status==='closed') return 'Pinjaman ditutup';
  if(role==='owner') return ownerSteps[status]??'Tinjau pinjaman';
  return 'Lihat perkembangan';
}

export default function Console({actor,initial}:{actor:Actor|null;initial:Data|null}){
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const apps=initial?.applications??[];
  const [selectedCustomer,setSelectedCustomer]=useState(initial?.customers[0]?.id??'');
  useEffect(()=>{
    const recent=sessionStorage.getItem('ln_new_customer');
    if(recent && initial?.customers.some(customer=>customer.id===recent)){
      setSelectedCustomer(recent);
      sessionStorage.removeItem('ln_new_customer');
      document.getElementById('new')?.scrollIntoView();
    }
  },[initial?.customers]);
  async function post(path:string,body:unknown){
    setError('');setMessage('');
    startTransition(async()=>{
      try{
        const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const result=await response.json();
        if(!response.ok) throw new Error(result.error??'Permintaan gagal');
        if(path==='/api/login'){window.location.hash='top';window.location.reload();return;}
        if(path==='/api/logout'){window.history.replaceState(null,'','/');window.location.reload();return;}
        if(path==='/api/actions'){
          const type=(body as {type?:string}).type;
          if(type==='customer'&&result.id) sessionStorage.setItem('ln_new_customer',result.id);
          window.location.hash=type==='customer'?'new':type==='policy'?'settings':'register';
          setMessage('Tersimpan. Memperbarui daftar pinjaman…');
        }
        window.location.reload();
      }catch(e){setError(e instanceof Error?e.message:'Permintaan gagal');}
    });
  }
  if(!actor) return <main className="loginPage"><div className="loginMark">LN <span>Operasional</span></div><div className="loginGrid"><section><h1>Setiap keputusan tercatat.</h1><p>Ruang kerja lokal untuk pengajuan, persetujuan, pencairan, dan pembayaran pinjaman.</p><div className="demoNotice">Lingkungan demo. Jangan gunakan data nasabah atau dana sungguhan.</div></section><form method="post" className="loginForm" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/login',{email:f.get('email'),password:f.get('password')});}}><h2>Masuk</h2><label>Email<input name="email" type="email" autoComplete="username" required placeholder="owner@local.test"/></label><label>Kata sandi<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={pending}>{pending?'Sedang masuk…':'Buka ruang kerja'}</button>{error&&<p className="error" role="alert">{error}</p>}</form></div></main>;
  const counts=initial?.counts??{pending:apps.filter(a=>a.status==='submitted').length,active:apps.filter(a=>a.status==='active').length};
  const priority=(status:string)=>actor.role==='owner'?(ownerSteps[status]?0:status==='closed'?2:1):status==='closed'?2:0;
  const orderedApps=[...apps].sort((a,b)=>priority(a.status)-priority(b.status));
  const ownerAction=orderedApps.find(app=>ownerSteps[app.status]);
  const openOfficerCases=apps.filter(app=>app.status!=='closed').length;
  const focus=actor.role==='owner'?(counts.pending?`${counts.pending} pengajuan menunggu keputusan`:ownerAction?`Langkah berikutnya: ${nextStep(actor.role,ownerAction.status)}`:'Tidak ada tindakan tertunda'):
    openOfficerCases?`${openOfficerCases} pinjaman masih berjalan`:'Tidak ada pinjaman aktif';
  return <main className="shell" id="top"><header className="mast"><div className="brand">LN <span>Operasional</span></div><div className="identity"><span>{displayName(actor.name)}<small>{roleLabels[actor.role]}</small></span><button className="textButton" onClick={()=>post('/api/logout',{})}>Keluar</button></div></header>
    <div className="workspace"><aside className="rail"><span className="railTitle">Ruang kerja</span><a className="overviewLink" href="#overview">Ringkasan</a><a href="#register">Daftar pinjaman</a>{actor.role==='officer'&&<><a href="#new">Ajukan pinjaman</a><a href="#borrower">Tambah nasabah</a></>}{actor.role==='owner'&&<><a href="/lokasi">Lokasi nasabah</a><a href="#settings">Kebijakan pinjaman</a></>}<div className="railFoot">Hanya untuk pengembangan<br/>Layanan penyedia disimulasikan</div></aside>
      <div className="content" id="overview"><div className="intro"><div><h1>{actor.role==='owner'?'Ringkasan portofolio':'Pinjaman Anda'}</h1><p>{actor.role==='owner'?'Tinjau keputusan, transfer, dan saldo pembukuan.':'Pantau pinjaman dan ajukan yang berikutnya.'}</p></div><span className="date">{new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'full'}).format(new Date())}</span></div>
      <section className="focusPanel" aria-label="Fokus saat ini"><div><small>Fokus saat ini</small><strong>{focus}</strong></div><a href={actor.role==='officer'?'#new':'#register'}>{actor.role==='officer'?'Ajukan pinjaman':'Lihat pinjaman'}</a></section>
      <section id="register" className="register"><div className="sectionHead"><div><h2>Daftar pinjaman</h2><p>{apps.length} pinjaman dapat Anda lihat</p></div></div>
        {apps.length===0?<div className="empty">Belum ada pinjaman. {actor.role==='officer'?'Tambahkan nasabah atau ajukan pinjaman di bawah.':'Pinjaman akan muncul di sini setelah diajukan.'}</div>:<div className="caseList">{orderedApps.map(app=><Case key={app.id} app={app} role={actor.role} pending={pending} post={post}/>)}</div>}
      </section>
      {actor.role==='owner'&&<section className="metrics" aria-label="Total portofolio"><div><small>Pokok belum dibayar</small><strong>{money(initial?.totals?.principal_outstanding)}</strong><span>Saldo pembukuan</span></div><div><small>Bunga belum diterima</small><strong>{money(initial?.totals?.interest_receivable)}</strong><span>Saldo pembukuan</span></div><div><small>Menunggu keputusan</small><strong>{counts.pending}</strong><span>Semua pengajuan</span></div><div><small>Pinjaman aktif</small><strong>{counts.active}</strong><span>Semua pengajuan</span></div></section>}
      {actor.role==='officer'&&<section className="newPanel" id="borrower"><div><h2>Tambah nasabah</h2><p>Gunakan data rekaan saja di lingkungan pengembangan ini. Dokumen identitas dan verifikasi lengkap belum tersedia.</p></div><form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'customer',name:f.get('name'),nik:f.get('nik'),phone:f.get('phone'),bankName:f.get('bankName'),accountNumber:f.get('accountNumber')});}}><label>Nama sesuai KTP<input name="name" required/></label><label>NIK 16 digit<input name="nik" inputMode="numeric" pattern="[0-9]{16}" required/></label><label>Nomor telepon<input name="phone" type="tel" required/></label><label>Nama bank<input name="bankName" required/></label><label>Nomor rekening<input name="accountNumber" inputMode="numeric" pattern="[0-9]{5,30}" required/></label><button disabled={pending}>Simpan nasabah</button></form></section>}
      {actor.role==='officer'&&<section className="newPanel" id="new"><div><h2>Ajukan pinjaman</h2><p>Kebijakan versi {initial?.policy?.version}: {money(initial?.policy?.min_principal)} sampai {money(initial?.policy?.max_principal)}, {initial?.policy?.min_weeks} sampai {initial?.policy?.max_weeks} minggu. Bunga tetap selama tenor: {Number(initial?.policy?.flat_interest_bps??0)/100}%.</p></div><form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'create',customerId:f.get('customerId'),principal:Number(f.get('principal')),weeks:Number(f.get('weeks'))});}}><label>Nasabah<select name="customerId" required value={selectedCustomer} onChange={e=>setSelectedCustomer(e.target.value)}>{initial?.customers.map(c=><option key={c.id} value={c.id}>{displayName(c.name)}</option>)}</select></label><label>Jumlah pinjaman (Rp)<input name="principal" type="number" min={initial?.policy?.min_principal} max={initial?.policy?.max_principal} step="1" required/></label><label>Tenor (minggu)<input name="weeks" type="number" min={initial?.policy?.min_weeks} max={initial?.policy?.max_weeks} step="1" required/></label><button disabled={pending}>Kirim untuk ditinjau</button></form></section>}
      {actor.role==='owner'&&<section className="newPanel" id="settings"><div><h2>Kebijakan pinjaman</h2><p>Versi saat ini {initial?.policy?.version}. Penyimpanan membuat versi baru untuk persetujuan berikutnya. Ketentuan yang sudah ditandatangani tetap berlaku.</p></div><form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'policy',minPrincipal:Number(f.get('minPrincipal')),maxPrincipal:Number(f.get('maxPrincipal')),flatInterestBps:Number(f.get('flatInterestBps')),minWeeks:Number(f.get('minWeeks')),maxWeeks:Number(f.get('maxWeeks'))});}}><label>Jumlah minimum (Rp)<input name="minPrincipal" type="number" min="1" defaultValue={initial?.policy?.min_principal} required/></label><label>Jumlah maksimum (Rp)<input name="maxPrincipal" type="number" min="1" defaultValue={initial?.policy?.max_principal} required/></label><label>Bunga tetap (basis poin)<input name="flatInterestBps" type="number" min="0" max="10000" defaultValue={initial?.policy?.flat_interest_bps} required/></label><label>Tenor minimum (minggu)<input name="minWeeks" type="number" min="1" defaultValue={initial?.policy?.min_weeks} required/></label><label>Tenor maksimum (minggu)<input name="maxWeeks" type="number" min="1" defaultValue={initial?.policy?.max_weeks} required/></label><button disabled={pending}>Buat versi kebijakan</button></form></section>}
      {pending&&<div className="feedback" role="status">Mohon tunggu…</div>}{error&&<div className="feedback error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Tutup pesan kesalahan">Tutup</button></div>}{message&&<div className="feedback" role="status">{message}</div>}</div></div></main>;
}

function Case({app,role,pending,post}:{app:Application;role:Actor['role'];pending:boolean;post:(path:string,body:unknown)=>void}){
  const [open,setOpen]=useState(false);
  const principal=Number(app.approved_principal??app.requested_principal);
  const total=Number(app.approved_principal??0)+Number(app.interest_amount??0);
  return <article className="case"><div className="caseTop"><div><span className="caseStatus">{labels[app.status]??app.status}</span><h3>{displayName(app.customer_name)}</h3><p>Diajukan oleh {displayName(app.officer_name)} · {new Date(app.submitted_at).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})}</p><p className="nextStep">{nextStep(role,app.status)}</p></div><div className="caseAmount"><strong>{money(principal)}</strong><button className="textButton" aria-expanded={open} aria-label={`${open?'Sembunyikan':'Tampilkan'} detail pinjaman ${displayName(app.customer_name)}`} onClick={()=>setOpen(!open)}>{open?'Sembunyikan detail':role==='owner'&&ownerSteps[app.status]?'Tinjau dan tindak':'Lihat detail'}</button></div></div>
    {open&&<div className="caseBody" id={`case-${app.id}`}><div className="facts"><div><small>Tenor</small><strong>{app.term_weeks} minggu</strong></div><div><small>Total tagihan</small><strong>{app.approved_principal?money(total):'Menunggu keputusan'}</strong></div><div><small>Sudah dibayar</small><strong>{money(app.paid)}</strong></div><div><small>Referensi transfer</small><strong>{app.transfer_reference??'Belum dikonfirmasi'}</strong></div></div>
      {app.snapshot&&<details><summary>Jadwal dan ketentuan yang disetujui</summary><div className="schedule"><p>Bunga tetap: {Number(app.snapshot.rateBps)/100}% untuk seluruh tenor. Kebijakan versi {app.snapshot.policyVersion}. Hash perjanjian demo: {app.snapshot_hash?.slice(0,16)}…</p><table><thead><tr><th>Angsuran</th><th>Jatuh tempo</th><th>Pokok</th><th>Bunga</th></tr></thead><tbody>{app.snapshot.schedule.map((i:any)=><tr key={i.sequence}><td>{i.sequence}</td><td>{new Date(`${i.dueAt}T12:00:00Z`).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})}</td><td>{money(i.principal)}</td><td>{money(i.interest)}</td></tr>)}</tbody></table></div></details>}
      <div className="actions">{role==='owner'&&app.status==='submitted'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'approve',applicationId:app.id})}>Setujui pengajuan</button>}
        {role==='owner'&&app.status==='signed'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'authorize',applicationId:app.id})}>Izinkan pencairan</button>}
        {role==='owner'&&app.status==='release_authorized'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'initiate',applicationId:app.id,idempotencyKey:`demo-${app.id}`})}>Mulai transfer</button>}
        {role==='owner'&&app.status==='transfer_initiated'&&<form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'confirm',applicationId:app.id,bankReference:f.get('bankReference'),proof:f.get('proof')});}}><p>Simulasi layanan bank. Masukkan referensi angka dan catatan bukti penyelesaian.</p><label>Referensi bank<input name="bankReference" inputMode="numeric" pattern="[0-9]+" required/></label><label>Catatan bukti<input name="proof" required/></label><button disabled={pending}>Konfirmasi transfer demo</button></form>}
        {role==='owner'&&app.status==='active'&&<form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'payment',applicationId:app.id,bankReference:f.get('bankReference'),amount:Number(f.get('amount'))});}}><label>Referensi pembayaran bank<input name="bankReference" required/></label><label>Jumlah terverifikasi (Rp)<input name="amount" type="number" min="1" max={total-Number(app.paid)} required/></label><button disabled={pending}>Catat pembayaran</button></form>}
        {role==='owner'&&app.status==='paid_off'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'close',applicationId:app.id})}>Tutup pinjaman lunas</button>}
        {app.status==='closed'&&<p className="completion">Semua kewajiban tercatat telah dibayar dan pinjaman ditutup.</p>}</div></div>}
  </article>;
}
