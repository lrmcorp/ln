'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {borrowerGrade} from '@/lib/grade';
import {PageHeader,Shell,StatusChip,displayName,money,shortDate,useAction,type StaffActor,type StaffRole} from './Shell';

type Payment={id:string;amount:string;reference:string|null;createdAt:string;recordedBy:string;amountSource:'entered'|'read_confirmed'|'read_auto';status:'pending'|'verified'|'rejected';
  method:'transfer'|'cash';fee:string;recovery:string;earlyPayoff:boolean;reviewNote:string|null;hasReceipt:boolean};
type Application={id:string;status:string;requested_principal:string;approved_principal:string|null;interest_amount:string|null;term_weeks:number|null;term_months:number|null;repayment_frequency:string;
  customer_name:string;customer_phone:string|null;officer_name:string;collector_id:string;collector_name:string|null;submitted_at:string;snapshot:any;snapshot_hash:string|null;signed_at:string|null;
  paid:string;recovered:string;remaining:string;fee:string;payoff_quote:string;pending_payments:number;restructure_pending:boolean;written_off_amount:string;
  transfer_reference:string|null;verification_status:string|null;signing_method:string|null;overdue_through_yesterday:string;installments:{sequence:number;dueAt:string;amount:string}[];payments:Payment[];grade_loans:number;grade_worst_dpd:number;grade_written_off:boolean};
export type Policy={version:number;min_principal:string;max_principal:string;late_fee_monthly_bps:number;weekly_rates:{weeks:number;rateBps:number}[];first_loan_max:string;repeat_growth_bps:number;max_installment_income_bps:number};
type Data={today:string;applications:Application[];totals:{net_cash:string;principal_outstanding:string;interest_receivable:string}|null;policy:Policy|null;
  counts:{pending:number;active:number;unverified:number;deposits:number}|null;officers:{id:string;name:string;branch_id:string}[]};
type Post=(path:string,body:unknown,hash?:string)=>void;
type Chain=(steps:{path:string;body:unknown}[],hash:string)=>void;

const labels:Record<string,string>={submitted:'Menunggu keputusan',awaiting_signature:'Menunggu tanda tangan',signed_pending_approval:'Menunggu persetujuan pemilik',approved:'Disetujui',signed:'Perjanjian ditandatangani',
  release_authorized:'Pencairan diizinkan',transfer_initiated:'Transfer dimulai',active:'Aktif',paid_off:'Lunas',closed:'Ditutup',written_off:'Dihapusbukukan'};
const ownerSteps:Record<string,string>={submitted:'Putuskan pengajuan',signed_pending_approval:'Periksa bukti dan setujui',signed:'Cairkan dana',release_authorized:'Cairkan dana',transfer_initiated:'Konfirmasi transfer',paid_off:'Tutup pinjaman'};
const WRITE_OFF_MIN_DPD=30;

// Days past due from the first installment not covered by payments; zero while nothing is overdue.
function dpdOf(app:Application,today:string){
  if(app.status!=='active')return 0;
  let cumulative=0;const paid=Number(app.paid);
  const first=app.installments.find(item=>(cumulative+=Number(item.amount))>paid);
  if(!first||first.dueAt>=today)return 0;
  return Math.round((Date.parse(`${today}T12:00:00Z`)-Date.parse(`${first.dueAt}T12:00:00Z`))/86400000);
}
function nextOpen(app:Application){
  let cumulative=0;const paid=Number(app.paid);
  for(const item of app.installments){const before=cumulative;cumulative+=Number(item.amount);if(cumulative>paid)return {...item,open:cumulative-Math.max(before,paid)};}
  return null;
}
const done=(status:string)=>['paid_off','closed','written_off'].includes(status);

function needsAction(app:Application,role:StaffRole,today:string){
  if(role==='owner')return !!ownerSteps[app.status]||app.pending_payments>0||dpdOf(app,today)>=WRITE_OFF_MIN_DPD;
  if(role==='manager')return app.pending_payments>0||dpdOf(app,today)>0;
  return app.status==='awaiting_signature'||app.restructure_pending||dpdOf(app,today)>0;
}

const tabs=[{key:'perlu',label:'Perlu tindakan'},{key:'aktif',label:'Aktif'},{key:'terlambat',label:'Terlambat'},{key:'proses',label:'Dalam proses'},{key:'selesai',label:'Selesai'},{key:'semua',label:'Semua'}] as const;
type TabKey=typeof tabs[number]['key'];

export default function Console({actor,initial}:{actor:StaffActor|null;initial:Data|null}){
  const action=useAction();
  const [tab,setTab]=useState<TabKey>('perlu');
  const [query,setQuery]=useState('');
  const apps=initial?.applications??[];
  const today=initial?.today??'';
  useEffect(()=>{
    const url=new URL(window.location.href);
    const signed=url.searchParams.get('signed');
    if(window.location.hash.startsWith('#case-'))setTab('semua');
    if(signed!=='1'&&signed!=='restructure')return;
    action.setMessage(signed==='restructure'?'Restrukturisasi ditandatangani. Jadwal baru sudah berlaku.':'Tanda tangan nasabah tersimpan. Pengajuan kini menunggu tinjauan pemilik.');
    url.searchParams.delete('signed');window.history.replaceState(null,'',url.pathname+url.search+url.hash);
    const timer=setTimeout(()=>action.setMessage(''),8000);return()=>clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const post:Post=(path,body,hash)=>action.run(path,body,{hash:hash??((body as {applicationId?:string})?.applicationId?`case-${(body as {applicationId:string}).applicationId}`:body instanceof FormData?`case-${body.get('applicationId')}`:'register')});
  const chain:Chain=(steps,hash)=>action.chain(steps,{hash});
  const filtered=useMemo(()=>{
    if(!actor)return [];
    const q=query.trim().toLocaleLowerCase('id-ID');
    const inTab=(app:Application)=>tab==='semua'||(tab==='perlu'&&needsAction(app,actor.role,today))||(tab==='aktif'&&app.status==='active')||(tab==='terlambat'&&dpdOf(app,today)>0)||
      (tab==='proses'&&!done(app.status)&&app.status!=='active')||(tab==='selesai'&&done(app.status));
    return apps.filter(app=>inTab(app)&&(!q||app.customer_name.toLocaleLowerCase('id-ID').includes(q)||displayName(app.customer_name).toLocaleLowerCase('id-ID').includes(q)))
      .sort((a,b)=>dpdOf(b,today)-dpdOf(a,today)||Number(needsAction(b,actor.role,today))-Number(needsAction(a,actor.role,today)));
  },[apps,tab,query,actor,today]);
  if(!actor)return <Login/>;
  const late=apps.filter(app=>dpdOf(app,today)>0);
  const counts=initial?.counts;
  const focus=actor.role==='owner'?(counts?.pending?`${counts.pending} pengajuan menunggu keputusan`:counts?.unverified?`${counts.unverified} pembayaran menunggu verifikasi`:late.length?`${late.length} pinjaman terlambat`:'Tidak ada tindakan tertunda'):
    actor.role==='manager'?(counts?.unverified||counts?.deposits?`${counts.unverified} pembayaran dan ${counts.deposits} setoran menunggu verifikasi`:late.length?`${late.length} pinjaman terlambat bayar`:'Semua pembayaran sudah diverifikasi'):
    late.length?`${late.length} pinjaman terlambat bayar`:`${apps.filter(app=>app.status==='active').length} pinjaman aktif`;
  return <Shell actor={actor} active="pinjaman">
    <PageHeader title={actor.role==='officer'?'Pinjaman Anda':'Daftar pinjaman'} subtitle={focus}
      actions={actor.role==='officer'?<><a className="button secondary" href="/tagihan">Tagihan hari ini</a><a className="button" href="/pengajuan/baru">Pengajuan baru</a></>:
        <><a className="button secondary" href="/tagihan">Lihat tagihan</a>{(counts?.unverified||counts?.deposits)?<a className="button" href="/verifikasi">Verifikasi sekarang</a>:null}</>}/>
    <section id="register" className="register"><div className="sectionHead"><div><h2>Daftar pinjaman</h2><p>{filtered.length} dari {apps.length} pinjaman</p></div>
      <label className="searchBox">Cari nasabah<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nama nasabah"/></label></div>
      <div className="tabs" role="tablist" aria-label="Saring pinjaman">{tabs.map(item=><button key={item.key} role="tab" aria-selected={tab===item.key} className={tab===item.key?'tab active':'tab'} onClick={()=>setTab(item.key)}>{item.label}</button>)}</div>
      {filtered.length===0?<div className="empty">{apps.length===0?(actor.role==='officer'?'Belum ada pinjaman. Mulai dari menu Pengajuan.':'Pinjaman akan muncul di sini setelah diajukan.'):query?'Tidak ada nasabah dengan nama itu.':'Tidak ada pinjaman di tab ini.'}</div>:
        <div className="caseList">{filtered.map(app=><Case key={app.id} app={app} role={actor.role} actorId={actor.id} today={today} officers={initial?.officers??[]} pending={action.pending} post={post} chain={chain} cash={initial?.totals?Number(initial.totals.net_cash):null}/>)}</div>}
    </section>
    {action.feedback}
  </Shell>;
}

function Login(){
  const action=useAction();
  return <main className="loginPage"><div className="loginMark">LN <span>Operasional</span></div><div className="loginGrid"><section><h1>Setiap keputusan tercatat.</h1><p>Ruang kerja untuk pengajuan, persetujuan, pencairan, penagihan, dan pembayaran pinjaman.</p><div className="demoNotice">Lingkungan demo. Jangan gunakan data nasabah atau dana sungguhan.</div></section>
    <form method="post" className="loginForm" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);action.run('/api/login',{login:f.get('login'),password:f.get('password')},{onDone:()=>{
      const next=new URLSearchParams(window.location.search).get('lanjut');
      window.location.assign(next&&/^\/tanda-tangan\/[0-9a-f-]{36}$/i.test(next)?next:'/');}});}}>
      <h2>Masuk</h2><label>Nama pengguna atau email<input name="login" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required placeholder="owner"/></label><label>Kata sandi<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={action.pending}>{action.pending?'Sedang masuk…':'Buka ruang kerja'}</button>{action.error&&<p className="error" role="alert">{action.error}</p>}</form></div></main>;
}

export function PolicyForm({policy,pending,post}:{policy:Policy|null;pending:boolean;post:Post}){
  const [rates,setRates]=useState((policy?.weekly_rates??[]).map(item=>({weeks:String(item.weeks),percent:String(item.rateBps/100)})));
  const update=(index:number,key:'weeks'|'percent',value:string)=>setRates(current=>current.map((item,i)=>i===index?{...item,[key]:value}:item));
  return <form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/actions',{type:'policy',minPrincipal:Number(f.get('minPrincipal')),maxPrincipal:Number(f.get('maxPrincipal')),
    lateFeeMonthlyBps:Math.round(Number(f.get('lateFeePercent'))*100),weeklyRates:rates.map(item=>({weeks:Number(item.weeks),rateBps:Math.round(Number(item.percent)*100)})),
    firstLoanMax:Number(f.get('firstLoanMax')),repeatGrowthBps:Math.round(Number(f.get('repeatGrowth'))*100),maxInstallmentIncomeBps:Math.round(Number(f.get('incomeShare'))*100)},'kebijakan');}}>
    <label>Jumlah minimum (Rp)<input name="minPrincipal" type="number" min="1" defaultValue={policy?.min_principal} required/></label>
    <label>Jumlah maksimum (Rp)<input name="maxPrincipal" type="number" min="1" defaultValue={policy?.max_principal} required/></label>
    <label>Batas pinjaman pertama (Rp)<input name="firstLoanMax" type="number" min="1" defaultValue={policy?.first_loan_max} required/></label>
    <label>Kenaikan batas setelah lunas tepat waktu (%)<input name="repeatGrowth" type="number" min="0" max="200" step="1" defaultValue={(policy?.repeat_growth_bps??5000)/100} required/></label>
    <label>Cicilan maksimal dari pendapatan mingguan (%)<input name="incomeShare" type="number" min="1" max="100" step="1" defaultValue={(policy?.max_installment_income_bps??3500)/100} required/></label>
    <label>Denda terlambat per bulan (%)<input name="lateFeePercent" type="number" min="0" max="100" step="0.01" defaultValue={(policy?.late_fee_monthly_bps??0)/100} required/></label>
    <fieldset className="rateTable"><legend>Bunga per tenor mingguan</legend>{rates.map((item,index)=><div className="rateRow" key={index}>
      <label>Tenor (minggu)<input type="number" min="1" max="52" step="1" value={item.weeks} onChange={e=>update(index,'weeks',e.target.value)} required/></label>
      <label>Bunga (%)<input type="number" min="0" max="100" step="0.01" value={item.percent} onChange={e=>update(index,'percent',e.target.value)} required/></label>
      <button type="button" className="textButton" disabled={rates.length===1} onClick={()=>setRates(current=>current.filter((_,i)=>i!==index))} aria-label={`Hapus tenor ${item.weeks} minggu`}>Hapus</button>
    </div>)}<button type="button" className="textButton" disabled={rates.length>=20} onClick={()=>setRates(current=>[...current,{weeks:'',percent:''}])}>Tambah tenor</button></fieldset>
    <button disabled={pending}>Buat versi kebijakan</button>
  </form>;
}

function Repayment({app,today}:{app:Application;today:string}){
  if(app.status==='written_off'){
    const recovered=Number(app.recovered),total=Number(app.written_off_amount);
    return <div className="repayment"><p><strong>{money(recovered)}</strong> dari {money(total)} dipulihkan setelah hapus buku</p></div>;
  }
  const remaining=Number(app.remaining),paidAll=app.payments.filter(p=>p.status!=='rejected').reduce((s,p)=>s+Number(p.amount),0),total=paidAll+remaining;
  const dpd=dpdOf(app,today),overdue=Math.max(0,Number(app.overdue_through_yesterday)-Number(app.paid))+Number(app.fee);
  return <div className="repayment"><p><strong>{money(paidAll)}</strong> dari {money(total)} dibayar{remaining>0&&` · sisa ${money(remaining)}`}</p>
    <div className="repaymentBar" role="progressbar" aria-label="Kemajuan pembayaran" aria-valuemin={0} aria-valuemax={total} aria-valuenow={paidAll}><span style={{width:`${total?Math.min(100,paidAll/total*100):0}%`}}/></div>
    {dpd>0&&<p className="lateNote">Tertunggak {money(overdue)}{Number(app.fee)>0&&` termasuk denda ${money(app.fee)}`}</p>}</div>;
}

function Installments({app,today}:{app:Application;today:string}){
  let left=Number(app.paid);
  return <div className="schedule"><table><thead><tr><th>Angsuran</th><th>Jatuh tempo</th><th>Jumlah</th><th>Status</th></tr></thead><tbody>{app.installments.map(item=>{
    const amount=Number(item.amount),covered=Math.min(amount,Math.max(0,left));left-=amount;
    const state=covered>=amount?'Lunas':item.dueAt<today?(covered?`Kurang ${money(amount-covered)}`:'Terlambat'):item.dueAt===today?(covered?`Kurang ${money(amount-covered)}, jatuh tempo hari ini`:'Jatuh tempo hari ini'):covered?`Sebagian ${money(covered)}`:'Belum jatuh tempo';
    return <tr key={item.sequence} className={covered<amount&&item.dueAt<today?'late':undefined}><td>Minggu ke-{item.sequence}</td><td>{shortDate(item.dueAt)}</td><td>{money(amount)}</td><td>{state}</td></tr>;
  })}</tbody></table></div>;
}

const paymentStatus:Record<Payment['status'],{label:string;tone:'pending'|'ok'|'late'}>={pending:{label:'Menunggu verifikasi',tone:'pending'},verified:{label:'Terverifikasi',tone:'ok'},rejected:{label:'Ditolak',tone:'late'}};

function PaymentForm({app,pending,post,role}:{app:Application;pending:boolean;post:Post;role:StaffRole}){
  const [amount,setAmount]=useState('');
  const [source,setSource]=useState<'entered'|'read_confirmed'>('entered');
  const [earlyPayoff,setEarlyPayoff]=useState(false);
  const [reading,setReading]=useState(false);
  const [readNote,setReadNote]=useState('');
  const latestFile=useRef<File|null>(null);
  const recovery=app.status==='written_off';
  const remaining=recovery?Number(app.written_off_amount)-Number(app.recovered):Number(app.remaining);
  const quote=Number(app.payoff_quote);
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
      else if(result.amount){setAmount(String(result.amount));setSource('read_confirmed');setEarlyPayoff(false);setReadNote(`Terbaca dari bukti: "${result.line}". Periksa sebelum menyimpan.`);}
      else{setAmount('');setSource('entered');setReadNote('Nominal tidak terbaca. Isi nominal sesuai bukti.');}
    }catch(cause){if(latestFile.current===file)setReadNote(cause instanceof Error?cause.message:'Bukti belum dapat dibaca');}
    finally{if(latestFile.current===file)setReading(false);}
  }
  const next=nextOpen(app);
  const suggested=Math.min(remaining,(next?.open??remaining)+Number(app.fee));
  return <form method="post" className="paymentForm" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);f.set('applicationId',app.id);f.set('amountSource',source);f.set('earlyPayoff',earlyPayoff?'1':'0');post('/api/payments',f);}}>
    <p>{recovery?`Pemulihan setelah hapus buku. Sisa yang dapat dipulihkan ${money(remaining)}.`:next?`Angsuran minggu ke-${next.sequence}: sisa ${money(next.open)}${Number(app.fee)>0?` + denda ${money(app.fee)}`:''}.`:`Sisa tagihan: ${money(remaining)}.`} Nominal boleh dikosongkan; sistem membacanya dari foto bukti.{role==='officer'&&' Pembayaran Anda diverifikasi manajer.'}</p>
    <label>Foto atau PDF bukti pembayaran<input name="receipt" type="file" accept="image/jpeg,image/png,application/pdf" required onChange={e=>readReceipt(e.target.files?.[0])}/></label>
    <label>Nominal dibayar (Rp, opsional)<input name="amount" type="number" min="1" max={remaining} placeholder={reading?'Membaca bukti…':String(suggested)} value={amount} readOnly={earlyPayoff} onChange={e=>{setAmount(e.target.value);setSource('entered');}}/></label>
    {readNote&&<p className="readNote" role="status">{readNote}</p>}
    <label>Cara bayar<select name="method" defaultValue={role==='officer'?'cash':'transfer'}><option value="transfer">Transfer bank</option><option value="cash">Tunai ke petugas</option></select></label>
    <label>Nomor referensi (opsional)<input name="reference" maxLength={100}/></label>
    {!recovery&&quote>0&&quote<remaining&&<div className="payoffOffer"><label className="signingCheck"><input type="checkbox" checked={earlyPayoff} onChange={e=>{setEarlyPayoff(e.target.checked);setAmount(e.target.checked?String(quote):'');setSource('entered');}}/>
      <span>Pelunasan dipercepat: bayar {money(quote)} sekarang. Bunga minggu yang belum berjalan ({money(remaining-quote)}) dihapus.</span></label></div>}
    <button disabled={pending||reading}>{reading?'Membaca bukti…':earlyPayoff?'Simpan pelunasan':'Simpan pembayaran'}</button></form>;
}

function Case({app,role,actorId,today,officers,pending,post,chain,cash}:{app:Application;role:StaffRole;actorId:string;today:string;officers:Data['officers'];pending:boolean;post:Post;chain:Chain;cash:number|null}){
  const [open,setOpen]=useState(false);
  const [enrollment,setEnrollment]=useState<{code:string;expiresAt:string}|null>(null);
  const [enrollmentError,setEnrollmentError]=useState('');
  const [enrollmentPending,setEnrollmentPending]=useState(false);
  useEffect(()=>{
    if(window.location.hash!==`#case-${app.id}`)return;
    setOpen(true);
    setTimeout(()=>document.getElementById(`case-${app.id}`)?.scrollIntoView({block:'start'}),0);
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
  const dpd=dpdOf(app,today);
  const next=nextOpen(app);
  const active=app.status==='active';
  const chip=dpd>0?<StatusChip tone="late">Terlambat {dpd} hari</StatusChip>:active&&next?.dueAt===today?<StatusChip tone="due">Jatuh tempo hari ini</StatusChip>:
    active?<StatusChip tone="ok">Lancar</StatusChip>:<StatusChip tone={app.status==='written_off'?'late':'neutral'}>{labels[app.status]??app.status}</StatusChip>;
  const headline=active?{label:'Sisa',value:money(app.remaining)}:app.status==='written_off'?{label:'Dihapusbukukan',value:money(app.written_off_amount)}:{label:'Pokok',value:money(app.approved_principal??app.requested_principal)};
  const isCollector=app.collector_id===actorId;
  const toggleLabel=open?'Tutup':role==='owner'&&ownerSteps[app.status]?'Tinjau':active&&role!=='owner'?'Catat bayar':'Detail';
  const sub=app.restructure_pending?'Menunggu tanda tangan restrukturisasi':active&&next?`Berikutnya ${shortDate(next.dueAt)} · ${money(next.open)}`:role==='owner'&&ownerSteps[app.status]?ownerSteps[app.status]:labels[app.status]??app.status;
  return <article className="case" id={`case-${app.id}`}><div className="caseTop"><div>{chip}{app.pending_payments>0&&<StatusChip tone="pending">{app.pending_payments} menunggu verifikasi</StatusChip>}<GradeChip app={app}/>
      <h3>{displayName(app.customer_name)}</h3><p>{role!=='officer'||!isCollector?`Penagih ${displayName(app.collector_name??app.officer_name)}`:`Diajukan ${shortDate(app.submitted_at)}`}</p><p className="nextStep">{sub}</p></div>
    <div className="caseAmount"><small>{headline.label}</small><strong>{headline.value}</strong><button className="textButton" aria-expanded={open} aria-label={`${toggleLabel}: ${displayName(app.customer_name)}`} onClick={()=>setOpen(!open)}>{toggleLabel}</button></div></div>
    {['active','paid_off','written_off'].includes(app.status)&&<Repayment app={app} today={today}/>}
    {open&&<div className="caseBody"><div className="facts"><div><small>Tenor</small><strong>{app.repayment_frequency==='monthly_first'?`${app.term_months} bulan`:`${app.term_weeks} minggu`}</strong></div><div><small>Pokok</small><strong>{money(app.approved_principal??app.requested_principal)}</strong></div><div><small>Diajukan oleh</small><strong>{displayName(app.officer_name)}</strong></div><div><small>Referensi transfer</small><strong>{app.transfer_reference??'Belum dikonfirmasi'}</strong></div></div>
      {app.installments.length>0&&<Installments app={app} today={today}/>}
      {app.payments.length>0&&<div className="paymentList"><h4>Riwayat pembayaran</h4><ul>{app.payments.map(item=><li key={item.id}><span><StatusChip tone={paymentStatus[item.status].tone}>{paymentStatus[item.status].label}</StatusChip> {shortDate(item.createdAt)} · {money(item.amount)} · {item.method==='cash'?'tunai':'transfer'}{item.reference&&` · Ref ${item.reference}`} · dicatat {displayName(item.recordedBy)}{item.earlyPayoff?' · pelunasan dipercepat':''}{item.amountSource==='read_auto'?' · nominal dibaca otomatis':item.amountSource==='read_confirmed'?' · nominal dari bukti, dikonfirmasi':''}{item.reviewNote&&` · ${item.reviewNote}`}</span>{item.hasReceipt&&<a href={`/api/payments/${item.id}/receipt`} target="_blank" rel="noopener noreferrer">Lihat bukti</a>}</li>)}</ul></div>}
      {app.verification_status&&role==='owner'&&<div className="evidenceReview"><p>Bukti identitas: {app.verification_status==='manual_review_completed'?'Ditinjau manual oleh pemilik':'Perlu tinjauan manual. Video bukan hasil verifikasi liveness otomatis.'}</p><a href={`/api/evidence/${app.id}/ktp`} target="_blank" rel="noopener noreferrer">Lihat foto KTP</a><a href={`/api/evidence/${app.id}/liveness`} target="_blank" rel="noopener noreferrer">Lihat video tantangan</a>{app.status==='signed_pending_approval'&&<button disabled={pending} onClick={()=>chain([
        ...(app.verification_status!=='manual_review_completed'?[{path:'/api/actions',body:{type:'review_evidence',applicationId:app.id,reason:'Bukti KTP dan video ditinjau manual oleh pemilik'}}]:[]),
        {path:'/api/actions',body:{type:'approve',applicationId:app.id}},{path:'/api/actions',body:{type:'authorize',applicationId:app.id}}],`case-${app.id}`)}>Bukti sesuai, setujui</button>}</div>}
      {app.snapshot&&<details><summary>Ketentuan yang ditandatangani</summary><div className="schedule"><p>Bunga tetap {Number(app.snapshot.rateBps)/100}% untuk seluruh tenor. Kebijakan versi {app.snapshot.policyVersion}. {app.signing_method&&`Ditandatangani di ${app.signing_method==='officer_device_demo'?'perangkat petugas':'sesi nasabah'}.`}</p>{Array.isArray(app.snapshot.terms)&&app.snapshot.terms.map((term:string,index:number)=><p key={index}>{term}</p>)}</div></details>}
      <div className="actions">
        {role==='officer'&&app.status==='awaiting_signature'&&<a className="caseActionLink" href={`/tanda-tangan/${app.id}`}>Buka syarat dan tanda tangan</a>}
        {role==='officer'&&app.restructure_pending&&<a className="caseActionLink" href={`/tanda-tangan/${app.id}`}>Buka restrukturisasi untuk ditandatangani nasabah</a>}
        {role!=='officer'&&active&&officers.length>0&&<form method="post" className="inlineForm" onSubmit={e=>{e.preventDefault();post('/api/ops',{type:'assign_collector',applicationId:app.id,collectorId:new FormData(e.currentTarget).get('collectorId')});}}>
          <label>Penagih<select name="collectorId" defaultValue={app.collector_id}>{officers.map(o=><option key={o.id} value={o.id}>{displayName(o.name)}</option>)}</select></label><button className="secondary" disabled={pending}>Simpan penagih</button></form>}
        {(active||app.status==='written_off')&&<PaymentForm app={app} pending={pending} post={post} role={role}/>}
        {active&&role!=='manager'&&<div className="mobileEnrollment"><button className="secondary" disabled={enrollmentPending} onClick={createEnrollment}>{enrollmentPending?'Membuat kode…':'Buat kode pemasangan APK'}</button>{enrollment&&<p>Kode sekali pakai untuk nasabah: <strong>{enrollment.code}</strong>. Berlaku sampai {new Date(enrollment.expiresAt).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})}. Berikan langsung kepada nasabah.</p>}{enrollmentError&&<p className="error" role="alert">{enrollmentError}</p>}</div>}
        {role==='owner'&&active&&<details className="ownerTools"><summary>Restrukturisasi atau hapus buku</summary>
          <form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);post('/api/ops',{type:'propose_restructure',applicationId:app.id,weeks:Number(f.get('weeks')),reason:String(f.get('reason'))});}}>
            <p>Sisa {money(Number(app.remaining)-Number(app.fee))} dijadwalkan ulang tanpa bunga tambahan. Berlaku setelah nasabah menandatangani di perangkat petugas.</p>
            <label>Tenor baru (minggu)<input name="weeks" type="number" min="1" max="52" defaultValue={8} required/></label><label>Alasan<input name="reason" required maxLength={500}/></label><button className="secondary" disabled={pending}>Ajukan restrukturisasi</button></form>
          {dpd>=WRITE_OFF_MIN_DPD?<form method="post" onSubmit={e=>{e.preventDefault();if(!window.confirm(`Hapus buku ${money(app.remaining)}? Piutang dicatat sebagai kerugian.`))return;post('/api/ops',{type:'write_off',applicationId:app.id,reason:String(new FormData(e.currentTarget).get('reason'))});}}>
            <p>Terlambat {dpd} hari. Hapus buku mencatat sisa {money(app.remaining)} sebagai kerugian; pembayaran berikutnya dicatat sebagai pemulihan.</p>
            <label>Alasan hapus buku<input name="reason" required maxLength={500}/></label><button className="danger" disabled={pending}>Hapus buku</button></form>:<p>Hapus buku tersedia setelah terlambat {WRITE_OFF_MIN_DPD} hari.</p>}
        </details>}
        {role==='owner'&&app.status==='submitted'&&<button disabled={pending} onClick={()=>post('/api/actions',{type:'approve',applicationId:app.id})}>Setujui pengajuan lama</button>}
        {role==='owner'&&['signed','release_authorized','transfer_initiated'].includes(app.status)&&<form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);chain([
            ...(app.status==='signed'?[{path:'/api/actions',body:{type:'authorize',applicationId:app.id}}]:[]),
            ...(app.status!=='transfer_initiated'?[{path:'/api/actions',body:{type:'initiate',applicationId:app.id,idempotencyKey:`demo-${app.id}`}}]:[]),
            {path:'/api/actions',body:{type:'confirm',applicationId:app.id,bankReference:f.get('bankReference'),proof:f.get('proof')}}],`case-${app.id}`);}}>
          {cash!==null&&cash<Number(app.approved_principal)&&<p className="error" role="alert">Kas tercatat {money(cash)}, kurang dari jumlah pencairan. Pastikan dana tersedia sebelum transfer.</p>}<p>Transfer {money(app.approved_principal)} ke rekening nasabah, lalu isi referensinya. Pinjaman aktif dan jadwal mingguan berjalan. Simulasi bank untuk demo.</p>
          <label>Referensi bank (angka)<input name="bankReference" inputMode="numeric" pattern="[0-9]+" required/></label><label>Catatan bukti transfer<input name="proof" required defaultValue="Transfer dari rekening operasional"/></label><button disabled={pending}>Cairkan dana</button></form>}
        {role==='owner'&&app.status==='paid_off'&&(app.pending_payments>0?<p>Tutup pinjaman setelah {app.pending_payments} pembayaran diverifikasi. <a href="/verifikasi">Buka verifikasi</a></p>:<button disabled={pending} onClick={()=>post('/api/actions',{type:'close',applicationId:app.id})}>Tutup pinjaman lunas</button>)}
        {app.status==='closed'&&<p className="completion">Semua kewajiban tercatat telah dibayar dan pinjaman ditutup.</p>}</div></div>}
  </article>;
}

const gradeTone={A:'ok',B:'neutral',C:'due',D:'late',Baru:'neutral'} as const;
function GradeChip({app}:{app:Application}){
  const g=borrowerGrade({loans:app.grade_loans,worstDpd:app.grade_worst_dpd,writtenOff:app.grade_written_off});
  return <span title={g.label}><StatusChip tone={gradeTone[g.grade]}>{g.grade==='Baru'?'Nasabah baru':`Kelas ${g.grade}`}<span className="srOnly"> · {g.label}</span></StatusChip></span>;
}
