'use client';
import {useEffect,useRef,useState,useTransition} from 'react';

type Actor={id:string;name:string;email:string;role:'owner'|'officer'|'manager'};
type Application={id:string;status:string;requested_principal:string;approved_principal:string|null;interest_amount:string|null;term_weeks:number|null;term_months:number|null;repayment_frequency:string;customer_name:string;officer_name:string;submitted_at:string;snapshot:any;snapshot_hash:string|null;signed_at:string|null;paid:string;transfer_reference:string|null;verification_status:string|null;signing_method:string|null;overdue_through_yesterday:string;installments:{sequence:number;dueAt:string;amount:string}[];payments:{id:string;amount:string;reference:string|null;createdAt:string;recordedBy:string;amountSource:'entered'|'read_confirmed'|'read_auto';hasReceipt:boolean}[]};
type Data={today:string;applications:Application[];customers:{id:string;name:string}[];totals:{net_cash:string;principal_outstanding:string;interest_receivable:string}|null;policy:{version:number;min_principal:string;max_principal:string;flat_interest_bps:number;min_weeks:number;max_weeks:number;min_months:number;max_months:number;late_fee_monthly_bps:number;weekly_rates:{weeks:number;rateBps:number}[]}|null;counts:{pending:number;active:number}|null};
const money=(value:string|number|null|undefined)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value??0));
const labels:Record<string,string>={submitted:'Menunggu keputusan',awaiting_signature:'Menunggu tanda tangan',signed_pending_approval:'Tanda tangan selesai, menunggu pemilik',approved:'Disetujui',signed:'Perjanjian ditandatangani',release_authorized:'Pencairan diizinkan',transfer_initiated:'Transfer dimulai',active:'Aktif',paid_off:'Lunas',closed:'Ditutup'};
const ownerSteps:Record<string,string>={submitted:'Putuskan pengajuan',signed_pending_approval:'Tinjau dan setujui syarat yang ditandatangani',signed:'Izinkan pencairan',release_authorized:'Mulai transfer',transfer_initiated:'Konfirmasi transfer',active:'Catat pembayaran',paid_off:'Tutup pinjaman'};
const roleLabels:Record<Actor['role'],string>={owner:'Pemilik',officer:'Petugas',manager:'Manajer cabang'};
const demoNames:Record<string,string>={'Demo Owner':'Pemilik Demo','Demo Officer':'Petugas Demo','Demo Manager':'Manajer Demo','Demo Borrower':'Nasabah Demo'};
const displayName=(name:string)=>demoNames[name]??name;
const totalDue=(app:Application)=>app.snapshot?Number(app.snapshot.total):Number(app.approved_principal??0)+Number(app.interest_amount??0);
// An installment is late only after its due date ends, matching the signed terms.
const overdue=(app:Application)=>app.status==='active'&&Number(app.overdue_through_yesterday)>Number(app.paid);
function nextStep(role:Actor['role'],status:string){
  if(status==='closed') return 'Pinjaman ditutup';
  if(role==='owner') return ownerSteps[status]??'Tinjau pinjaman';
  if(role==='manager') return status==='active'?'Catat pembayaran':'Lihat perkembangan';
  if(status==='awaiting_signature')return 'Serahkan syarat kepada nasabah untuk ditandatangani';
  if(status==='active')return 'Catat pembayaran';
  return 'Lihat perkembangan';
}

export default function Console({actor,initial}:{actor:Actor|null;initial:Data|null}){
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const apps=initial?.applications??[];
  useEffect(()=>{
    const url=new URL(window.location.href);
    if(url.searchParams.get('signed')!=='1')return;
    setMessage('Tanda tangan nasabah tersimpan. Pengajuan kini menunggu tinjauan pemilik.');
    url.searchParams.delete('signed');window.history.replaceState(null,'',url.pathname+url.search+url.hash);
    const timer=setTimeout(()=>setMessage(''),8000);return()=>clearTimeout(timer);
  },[]);
  async function post(path:string,body:unknown){
    setError('');setMessage('');
    startTransition(async()=>{
      try{
        const response=body instanceof FormData?await fetch(path,{method:'POST',body}):await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const result=await response.json();
        if(!response.ok) throw new Error(result.error??'Permintaan gagal');
        if(path==='/api/login'){
          const next=new URLSearchParams(window.location.search).get('lanjut');
          if(next&&/^\/tanda-tangan\/[0-9a-f-]{36}$/i.test(next))window.location.assign(next);
          else{window.location.hash='top';window.location.reload();}
          return;
        }
        if(path==='/api/logout'){window.history.replaceState(null,'','/');window.location.reload();return;}
        if(path==='/api/payments'&&body instanceof FormData){
          window.location.hash=`case-${body.get('applicationId')}`;
          setMessage('Pembayaran tersimpan. Memperbarui daftar pinjaman…');
        }
        if(path==='/api/actions'){
          const {type,applicationId}=body as {type?:string;applicationId?:string};
          window.location.hash=type==='policy'?'settings':applicationId?`case-${applicationId}`:'register';
          setMessage('Tersimpan. Memperbarui daftar pinjaman…');
        }
        window.location.reload();
      }catch(e){setError(e instanceof Error?e.message:'Permintaan gagal');}
    });
  }
  if(!actor) return <main className="loginPage"><div className="loginMark">LN <span>Operasional</span></div><div className="loginGrid"><section><h1>Setiap keputusan tercatat.</h1><p>Ruang kerja lokal untuk pengajuan, persetujuan, pencairan, dan pembayaran pinjaman.</p><div className="demoNotice">Lingkungan demo. Jangan gunakan data nasabah atau dana sungguhan.</div></section><form method="post" className="loginForm" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/login',{login:f.get('login'),password:f.get('password')});}}><h2>Masuk</h2><label>Nama pengguna atau email<input name="login" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required placeholder="owner"/></label><label>Kata sandi<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={pending}>{pending?'Sedang masuk…':'Buka ruang kerja'}</button>{error&&<p className="error" role="alert">{error}</p>}</form></div></main>;
  const counts=initial?.counts??{pending:apps.filter(a=>['submitted','signed_pending_approval'].includes(a.status)).length,active:apps.filter(a=>a.status==='active').length};
  const priority=(app:Application)=>actor.role==='owner'?(ownerSteps[app.status]?0:app.status==='closed'?2:1):
    (overdue(app)?0:app.status==='active'?1:app.status==='closed'?3:2);
  const orderedApps=[...apps].sort((a,b)=>priority(a)-priority(b));
  const late=apps.filter(overdue).length,activeCount=apps.filter(app=>app.status==='active').length;
  const ownerAction=orderedApps.find(app=>ownerSteps[app.status]);
  const openOfficerCases=apps.filter(app=>app.status!=='closed').length;
  const focus=actor.role==='manager'?(late?`${late} pinjaman terlambat bayar`:activeCount?`${activeCount} pinjaman aktif, tidak ada yang terlambat`:'Tidak ada pinjaman aktif'):
    actor.role==='owner'?(counts.pending?`${counts.pending} pengajuan menunggu keputusan`:ownerAction?`Langkah berikutnya: ${nextStep(actor.role,ownerAction.status)}`:'Tidak ada tindakan tertunda'):
    late?`${late} pinjaman terlambat bayar`:openOfficerCases?`${openOfficerCases} pinjaman masih berjalan`:'Tidak ada pinjaman aktif';
  return <main className="shell" id="top"><header className="mast"><div className="brand">LN <span>Operasional</span></div><div className="identity"><span>{displayName(actor.name)}<small>{roleLabels[actor.role]}</small></span><button className="textButton" onClick={()=>post('/api/logout',{})}>Keluar</button></div></header>
    <div className="workspace"><aside className="rail"><span className="railTitle">Ruang kerja</span><a className="overviewLink" href="#overview">Ringkasan</a><a href="#register">Daftar pinjaman</a>{actor.role==='officer'&&<a href="/pengajuan/baru">Pengajuan baru</a>}{actor.role!=='officer'&&<a href="/lokasi">Lokasi nasabah</a>}{actor.role==='owner'&&<a href="#settings">Kebijakan pinjaman</a>}<div className="railFoot">Hanya untuk pengembangan<br/>Layanan penyedia disimulasikan</div></aside>
      <div className="content" id="overview"><div className="intro"><div><h1>{actor.role==='owner'?'Ringkasan portofolio':actor.role==='manager'?'Pembayaran cabang':'Pinjaman Anda'}</h1><p>{actor.role==='owner'?'Tinjau keputusan, transfer, dan saldo pembukuan.':actor.role==='manager'?'Catat setiap pembayaran mingguan beserta bukti.':'Pantau pinjaman dan ajukan yang berikutnya.'}</p></div><span className="date">{new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'full'}).format(new Date())}</span></div>
      <section className="focusPanel" aria-label="Fokus saat ini"><div><small>Fokus saat ini</small><strong>{focus}</strong></div><a href={actor.role==='officer'?'/pengajuan/baru':'#register'}>{actor.role==='officer'?'Buat pengajuan':'Lihat pinjaman'}</a></section>
      <section id="register" className="register"><div className="sectionHead"><div><h2>Daftar pinjaman</h2><p>{apps.length} pinjaman dapat Anda lihat</p></div></div>
        {apps.length===0?<div className="empty">Belum ada pinjaman. {actor.role==='officer'?'Tambahkan nasabah atau ajukan pinjaman di bawah.':'Pinjaman akan muncul di sini setelah diajukan.'}</div>:<div className="caseList">{orderedApps.map(app=><Case key={app.id} app={app} role={actor.role} today={initial?.today??''} pending={pending} post={post}/>)}</div>}
      </section>
      {actor.role==='owner'&&<section className="metrics" aria-label="Total portofolio"><div><small>Pokok belum dibayar</small><strong>{money(initial?.totals?.principal_outstanding)}</strong><span>Saldo pembukuan</span></div><div><small>Bunga belum diterima</small><strong>{money(initial?.totals?.interest_receivable)}</strong><span>Saldo pembukuan</span></div><div><small>Menunggu keputusan</small><strong>{counts.pending}</strong><span>Semua pengajuan</span></div><div><small>Pinjaman aktif</small><strong>{counts.active}</strong><span>Semua pengajuan</span></div></section>}
      {actor.role==='officer'&&<section className="newPanel intakeEntry"><div><h2>Pengajuan nasabah baru</h2><p>Tiga langkah: data dan bukti, jumlah dan jadwal, lalu tanda tangan nasabah. Foto KTP dan video tantangan disimpan terenkripsi untuk tinjauan manual.</p></div><a href="/pengajuan/baru">Mulai pengajuan</a></section>}
      {actor.role==='owner'&&<section className="newPanel" id="settings"><div><h2>Kebijakan pinjaman</h2><p>Versi saat ini {initial?.policy?.version}. Penyimpanan membuat versi baru untuk pengajuan berikutnya. Syarat yang sudah ditandatangani tetap pada versinya dan perubahan harus ditandatangani ulang.</p></div>
        <PolicyForm policy={initial?.policy??null} pending={pending} post={post}/></section>}
      {pending&&<div className="feedback" role="status">Mohon tunggu…</div>}{error&&<div className="feedback error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Tutup pesan kesalahan">Tutup</button></div>}{message&&<div className="feedback" role="status">{message}</div>}</div></div></main>;
}

function PolicyForm({policy,pending,post}:{policy:Data['policy'];pending:boolean;post:(path:string,body:unknown)=>void}){
  const [rates,setRates]=useState((policy?.weekly_rates??[]).map(item=>({weeks:String(item.weeks),percent:String(item.rateBps/100)})));
  const update=(index:number,key:'weeks'|'percent',value:string)=>setRates(current=>current.map((item,i)=>i===index?{...item,[key]:value}:item));
  return <form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'policy',minPrincipal:Number(f.get('minPrincipal')),maxPrincipal:Number(f.get('maxPrincipal')),
    lateFeeMonthlyBps:Math.round(Number(f.get('lateFeePercent'))*100),weeklyRates:rates.map(item=>({weeks:Number(item.weeks),rateBps:Math.round(Number(item.percent)*100)}))});}}>
    <label>Jumlah minimum (Rp)<input name="minPrincipal" type="number" min="1" defaultValue={policy?.min_principal} required/></label>
    <label>Jumlah maksimum (Rp)<input name="maxPrincipal" type="number" min="1" defaultValue={policy?.max_principal} required/></label>
    <label>Denda terlambat per bulan (%)<input name="lateFeePercent" type="number" min="0" max="100" step="0.01" defaultValue={(policy?.late_fee_monthly_bps??0)/100} required/></label>
    <fieldset className="rateTable"><legend>Bunga per tenor mingguan</legend>{rates.map((item,index)=><div className="rateRow" key={index}>
      <label>Tenor (minggu)<input type="number" min="1" max="52" step="1" value={item.weeks} onChange={e=>update(index,'weeks',e.target.value)} required/></label>
      <label>Bunga (%)<input type="number" min="0" max="100" step="0.01" value={item.percent} onChange={e=>update(index,'percent',e.target.value)} required/></label>
      <button type="button" className="textButton" disabled={rates.length===1} onClick={()=>setRates(current=>current.filter((_,i)=>i!==index))} aria-label={`Hapus tenor ${item.weeks} minggu`}>Hapus</button>
    </div>)}<button type="button" className="textButton" disabled={rates.length>=20} onClick={()=>setRates(current=>[...current,{weeks:'',percent:''}])}>Tambah tenor</button></fieldset>
    <button disabled={pending}>Buat versi kebijakan</button>
  </form>;
}

function Repayment({app}:{app:Application}){
  const total=totalDue(app),paid=Number(app.paid);
  return <div className="repayment"><p><strong>{money(paid)}</strong> dari {money(total)} dibayar{paid<total&&` · sisa ${money(total-paid)}`}</p>
    <div className="repaymentBar" role="progressbar" aria-label="Kemajuan pembayaran" aria-valuemin={0} aria-valuemax={total} aria-valuenow={paid}><span style={{width:`${total?Math.min(100,paid/total*100):0}%`}}/></div>
    {overdue(app)&&<p className="lateNote">Terlambat {money(Number(app.overdue_through_yesterday)-paid)}</p>}</div>;
}

function Installments({app,today}:{app:Application;today:string}){
  let left=Number(app.paid);
  return <div className="schedule"><table><thead><tr><th>Angsuran</th><th>Jatuh tempo</th><th>Jumlah</th><th>Status</th></tr></thead><tbody>{app.installments.map(item=>{
    const amount=Number(item.amount),covered=Math.min(amount,Math.max(0,left));left-=amount;
    const state=covered>=amount?'Lunas':item.dueAt<today?(covered?`Kurang ${money(amount-covered)}`:'Terlambat'):item.dueAt===today?(covered?`Kurang ${money(amount-covered)}, jatuh tempo hari ini`:'Jatuh tempo hari ini'):covered?`Sebagian ${money(covered)}`:'Belum jatuh tempo';
    return <tr key={item.sequence} className={covered<amount&&item.dueAt<today?'late':undefined}><td>Minggu ke-{item.sequence}</td><td>{new Date(`${item.dueAt}T12:00:00Z`).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})}</td><td>{money(amount)}</td><td>{state}</td></tr>;
  })}</tbody></table></div>;
}

function PaymentForm({app,pending,post}:{app:Application;pending:boolean;post:(path:string,body:unknown)=>void}){
  const [amount,setAmount]=useState('');
  const [source,setSource]=useState<'entered'|'read_confirmed'>('entered');
  const [reading,setReading]=useState(false);
  const [readNote,setReadNote]=useState('');
  const latestFile=useRef<File|null>(null);
  const remaining=totalDue(app)-Number(app.paid);
  async function readReceipt(file:File|undefined){
    latestFile.current=file??null;
    setReadNote('');
    if(!file)return;
    if(file.type==='application/pdf'){setReadNote('PDF tidak dibaca otomatis. Isi nominal sesuai bukti.');return;}
    if(amount&&source==='entered')return;
    setReading(true);
    try{
      const body=new FormData();body.set('applicationId',app.id);body.set('receipt',file);
      const response=await fetch('/api/payments/read',{method:'POST',body});
      const result=await response.json();
      if(latestFile.current!==file)return;
      if(!response.ok)throw new Error(result.error??'Bukti belum dapat dibaca');
      if(result.amount>remaining){setAmount('');setSource('entered');setReadNote(`Terbaca ${money(result.amount)} dari "${result.line}", melebihi sisa tagihan ${money(remaining)}. Isi nominal sesuai bukti.`);}
      else if(result.amount){setAmount(String(result.amount));setSource('read_confirmed');setReadNote(`Terbaca dari bukti: "${result.line}". Periksa sebelum menyimpan.`);}
      else{setAmount('');setSource('entered');setReadNote('Nominal tidak terbaca. Isi nominal sesuai bukti.');}
    }catch(cause){if(latestFile.current===file)setReadNote(cause instanceof Error?cause.message:'Bukti belum dapat dibaca');}
    finally{if(latestFile.current===file)setReading(false);}
  }
  let cumulative=0;
  const next=app.installments.map(item=>({sequence:item.sequence,through:cumulative+=Number(item.amount)})).find(item=>item.through>Number(app.paid));
  const suggested=Math.min(remaining,next?next.through-Number(app.paid):remaining);
  return <form method="post" className="paymentForm" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);f.set('applicationId',app.id);f.set('amountSource',source);post('/api/payments',f);}}>
    <p>{next?`Angsuran minggu ke-${next.sequence}: sisa ${money(suggested)}.`:`Sisa tagihan: ${money(suggested)}.`} Nominal boleh dikosongkan; sistem membacanya dari foto bukti.</p>
    <label>Foto atau PDF bukti pembayaran<input name="receipt" type="file" accept="image/jpeg,image/png,application/pdf" required onChange={e=>readReceipt(e.target.files?.[0])}/></label>
    <label>Nominal dibayar (Rp, opsional)<input name="amount" type="number" min="1" max={remaining} placeholder={reading?'Membaca bukti…':String(suggested)} value={amount} onChange={e=>{setAmount(e.target.value);setSource('entered');}}/></label>
    {readNote&&<p className="readNote" role="status">{readNote}</p>}
    <label>Nomor referensi (opsional)<input name="reference" maxLength={100}/></label>
    <button disabled={pending||reading}>{reading?'Membaca bukti…':'Simpan pembayaran'}</button></form>;
}

function Case({app,role,today,pending,post}:{app:Application;role:Actor['role'];today:string;pending:boolean;post:(path:string,body:unknown)=>void}){
  const [open,setOpen]=useState(false);
  const [enrollment,setEnrollment]=useState<{code:string;expiresAt:string}|null>(null);
  const [enrollmentError,setEnrollmentError]=useState('');
  const [enrollmentPending,setEnrollmentPending]=useState(false);
  useEffect(()=>{
    if(window.location.hash!==`#case-${app.id}`)return;
    setOpen(true);
    document.getElementById(`case-${app.id}`)?.scrollIntoView({block:'start'});
  },[app.id]);
  async function createEnrollment(){
    setEnrollmentPending(true);setEnrollmentError('');setEnrollment(null);
    try{
      const response=await fetch('/api/mobile/enrollment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({applicationId:app.id})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??'Gagal membuat kode APK');
      setEnrollment(result);
    }catch(error){setEnrollmentError(error instanceof Error?error.message:'Gagal membuat kode APK');}
    finally{setEnrollmentPending(false);}
  }
  const principal=Number(app.approved_principal??app.requested_principal);
  const total=totalDue(app);
  let cumulative=0;
  const upcoming=app.status==='active'?app.installments.find(item=>(cumulative+=Number(item.amount))>Number(app.paid)):undefined;
  const nextDue=upcoming&&new Date(`${upcoming.dueAt}T12:00:00Z`).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta',day:'numeric',month:'long'});
  const toggleLabel=open?'Sembunyikan detail':role==='owner'&&ownerSteps[app.status]?'Tinjau dan tindak':role!=='owner'&&app.status==='active'?'Catat pembayaran':'Lihat detail';
  return <article className="case" id={`case-${app.id}`}><div className="caseTop"><div><span className="caseStatus">{labels[app.status]??app.status}</span><h3>{displayName(app.customer_name)}</h3><p>Diajukan oleh {displayName(app.officer_name)} · {new Date(app.submitted_at).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})}</p><p className="nextStep">{nextDue?`Angsuran berikutnya ${nextDue}`:nextStep(role,app.status)}</p></div><div className="caseAmount"><strong>{money(principal)}</strong><button className="textButton" aria-expanded={open} aria-label={`${toggleLabel}: ${displayName(app.customer_name)}`} onClick={()=>setOpen(!open)}>{toggleLabel}</button></div></div>
    {['active','paid_off'].includes(app.status)&&<Repayment app={app}/>}
    {open&&<div className="caseBody"><div className="facts"><div><small>Tenor</small><strong>{app.repayment_frequency==='monthly_first'?`${app.term_months} bulan`:`${app.term_weeks} minggu`}</strong></div><div><small>Total tagihan</small><strong>{app.snapshot?money(Number(app.snapshot.total)):app.approved_principal?money(total):'Menunggu tanda tangan'}</strong></div><div><small>Sudah dibayar</small><strong>{money(app.paid)}</strong></div><div><small>Referensi transfer</small><strong>{app.transfer_reference??'Belum dikonfirmasi'}</strong></div></div>
      {app.installments.length>0&&app.repayment_frequency==='weekly_from_approval'&&<Installments app={app} today={today}/>}
      {app.payments.length>0&&<div className="paymentList"><h4>Riwayat pembayaran</h4><ul>{app.payments.map(item=><li key={item.id}><span>{new Date(item.createdAt).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})} · {money(item.amount)}{item.reference&&` · Ref ${item.reference}`} · dicatat {displayName(item.recordedBy)}{item.amountSource==='read_auto'?' · nominal dibaca otomatis, periksa bukti':item.amountSource==='read_confirmed'?' · nominal dari bukti, dikonfirmasi':''}</span>{item.hasReceipt&&<a href={`/api/payments/${item.id}/receipt`} target="_blank" rel="noopener noreferrer">Lihat bukti</a>}</li>)}</ul></div>}
      {app.verification_status&&role!=='manager'&&<div className="evidenceReview"><p>Bukti identitas: {app.verification_status==='manual_review_completed'?'Ditinjau manual oleh pemilik':'Perlu tinjauan manual. Video bukan hasil verifikasi liveness otomatis.'}</p><a href={`/api/evidence/${app.id}/ktp`} target="_blank" rel="noopener noreferrer">Lihat foto KTP</a><a href={`/api/evidence/${app.id}/liveness`} target="_blank" rel="noopener noreferrer">Lihat video tantangan</a>{role==='owner'&&app.verification_status!=='manual_review_completed'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'review_evidence',applicationId:app.id,reason:'Bukti KTP dan video ditinjau manual dalam demo'})}>Tandai sudah ditinjau</button>}</div>}
      {app.snapshot&&<details><summary>Jadwal dan ketentuan yang ditandatangani</summary><div className="schedule"><p>Bunga tetap: {Number(app.snapshot.rateBps)/100}% untuk seluruh tenor. Kebijakan versi {app.snapshot.policyVersion}. Hash perjanjian demo: {app.snapshot_hash?.slice(0,16)}… {app.signing_method&&`Metode: ${app.signing_method==='officer_device_demo'?'perangkat petugas':'sesi nasabah'}.`}</p><table><thead><tr><th>Angsuran</th><th>Jatuh tempo</th><th>Pokok</th><th>Bunga</th></tr></thead><tbody>{app.snapshot.schedule.map((i:any)=><tr key={i.sequence}><td>{i.sequence}</td><td>{i.dueAt?new Date(`${i.dueAt}T12:00:00Z`).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'}):'Mingguan sejak disetujui'}</td><td>{money(i.principal)}</td><td>{money(i.interest)}</td></tr>)}</tbody></table>{Array.isArray(app.snapshot.terms)&&app.snapshot.terms.map((term:string,index:number)=><p key={index}>{term}</p>)}</div></details>}
      <div className="actions">{role==='officer'&&app.status==='awaiting_signature'&&<a className="caseActionLink" href={`/tanda-tangan/${app.id}`}>Buka syarat dan tanda tangan</a>}
        {app.status==='active'&&role!=='manager'&&<div className="mobileEnrollment"><button disabled={enrollmentPending} onClick={createEnrollment}>{enrollmentPending?'Membuat kode…':'Buat kode pemasangan APK'}</button>{enrollment&&<p>Kode sekali pakai untuk nasabah: <strong>{enrollment.code}</strong>. Berlaku sampai {new Date(enrollment.expiresAt).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})}. Berikan langsung kepada nasabah; jangan kirim melalui kanal publik.</p>}{enrollmentError&&<p className="error" role="alert">{enrollmentError}</p>}</div>}
        {role==='owner'&&app.status==='submitted'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'approve',applicationId:app.id})}>Setujui pengajuan lama</button>}
        {role==='owner'&&app.status==='signed_pending_approval'&&<button disabled={pending||app.verification_status!=='manual_review_completed'} onClick={()=>post('/api/actions',{type:'approve',applicationId:app.id})}>Setujui syarat</button>}
        {role==='owner'&&app.status==='signed'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'authorize',applicationId:app.id})}>Izinkan pencairan</button>}
        {role==='owner'&&app.status==='release_authorized'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'initiate',applicationId:app.id,idempotencyKey:`demo-${app.id}`})}>Mulai transfer</button>}
        {role==='owner'&&app.status==='transfer_initiated'&&<form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'confirm',applicationId:app.id,bankReference:f.get('bankReference'),proof:f.get('proof')});}}><p>Simulasi layanan bank. Masukkan referensi angka dan catatan bukti penyelesaian.</p><label>Referensi bank<input name="bankReference" inputMode="numeric" pattern="[0-9]+" required/></label><label>Catatan bukti<input name="proof" required/></label><button disabled={pending}>Konfirmasi transfer demo</button></form>}
        {app.status==='active'&&<PaymentForm app={app} pending={pending} post={post}/>}
        {role==='owner'&&app.status==='paid_off'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'close',applicationId:app.id})}>Tutup pinjaman lunas</button>}
        {app.status==='closed'&&<p className="completion">Semua kewajiban tercatat telah dibayar dan pinjaman ditutup.</p>}</div></div>}
  </article>;
}
