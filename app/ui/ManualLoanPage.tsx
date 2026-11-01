'use client';
import {useMemo,useState} from 'react';
import {PageHeader,Shell,displayName,money,useAction,type StaffActor} from './Shell';

type Policy={min_principal:string;max_principal:string;weekly_rates:{weeks:number;rateBps:number}[]}|null;
type Officer={id:string;name:string;branch_id:string};

// Two staff shortcuts on one page: a new loan without the field intake, and an old loan typed in from paper records.
export default function ManualLoanPage({actor,policy,officers,branches,initialMode}:{actor:StaffActor;policy:Policy;officers:Officer[];branches:{id:string;name:string}[];initialMode:'quick'|'import'}){
  const action=useAction();
  const [mode,setMode]=useState(initialMode);
  // Only branches that have an officer to collect can take a loan.
  const usable=branches.filter(b=>officers.some(o=>o.branch_id===b.id));
  const [branchId,setBranchId]=useState(usable.length===1?usable[0].id:'');
  const rates=policy?.weekly_rates??[];
  const [principal,setPrincipal]=useState('');
  const [weeks,setWeeks]=useState(String(rates[0]?.weeks??4));
  const [interest,setInterest]=useState('');
  const [paid,setPaid]=useState('');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
  const branchOfficers=officers.filter(o=>actor.role==='manager'||o.branch_id===branchId);
  const amount=Number(principal)||0,rate=rates.find(r=>String(r.weeks)===weeks);
  const autoInterest=rate?Math.round(amount*rate.rateBps/10000):0;
  const loanInterest=mode==='import'&&interest!==''?Number(interest):autoInterest;
  const total=amount+loanInterest,weekly=Number(weeks)?Math.ceil(total/Number(weeks)):0;
  const remaining=Math.max(0,total-(Number(paid)||0));
  const preview=useMemo(()=>amount>0&&Number(weeks)>0,[amount,weeks]);
  function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    const f=new FormData(event.currentTarget);
    const base={name:String(f.get('name')),phone:String(f.get('phone')),nik:String(f.get('nik')||'')||null,branchId:actor.role==='owner'?branchId:null,collectorId:String(f.get('collectorId')),
      principal:amount,weeks:Number(weeks)};
    const body=mode==='quick'?{type:'quick',...base}:{type:'import',...base,interest:loanInterest,disbursedOn:String(f.get('disbursedOn')),paid:Number(paid)||0};
    action.run('/api/manual',body,{onDone:result=>window.location.assign(`/pinjaman#case-${result.id}`)});
  }
  return <Shell actor={actor} active="tambah">
    <PageHeader title="Tambah pinjaman" subtitle={mode==='quick'?'Pinjaman baru tanpa formulir lapangan. Siap dicairkan setelah disimpan.':'Pinjaman yang sudah berjalan di luar aplikasi. Langsung aktif dengan jadwal mingguan sejak tanggal cair.'}
      actions={actor.role==='manager'?<a className="button secondary" href="/pengajuan/baru">Pengajuan lengkap (KTP dan tanda tangan)</a>:undefined}/>
    <div className="tabs segTabs" role="tablist" aria-label="Jenis input">
      <button role="tab" aria-selected={mode==='quick'} className={mode==='quick'?'tab active':'tab'} onClick={()=>setMode('quick')}>Pinjaman baru cepat</button>
      <button role="tab" aria-selected={mode==='import'} className={mode==='import'?'tab active':'tab'} onClick={()=>setMode('import')}>Input pinjaman lama</button></div>
    {!policy?<div className="empty">Belum ada kebijakan pinjaman. Buat dulu di Kebijakan pinjaman.</div>:
    <form className="card manualForm" method="post" onSubmit={submit}>
      <fieldset><legend>Nasabah</legend>
        <label>Nama lengkap<input name="name" required maxLength={200} autoComplete="off"/></label>
        <label>Nomor HP<input name="phone" required inputMode="tel" pattern="[0-9+ \-]{8,20}" placeholder="0812…"/></label>
        <label>NIK (opsional)<input name="nik" inputMode="numeric" pattern="[0-9]{16}" placeholder="16 digit, untuk mengenali nasabah lama"/></label></fieldset>
      <fieldset><legend>Penagih</legend>
        {actor.role==='owner'&&<label>Cabang<select required value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">Pilih cabang</option>{usable.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        <label>Petugas penagih<select name="collectorId" required defaultValue={branchOfficers.length===1?branchOfficers[0].id:''} key={branchId}><option value="">Pilih petugas</option>{branchOfficers.map(o=><option key={o.id} value={o.id}>{displayName(o.name)}</option>)}</select></label>
        {officers.length===0&&<p className="error">Belum ada petugas aktif. Tambahkan di Cabang dan pengguna.</p>}</fieldset>
      <fieldset><legend>Pinjaman</legend>
        <label>Pokok (Rp)<input required type="number" min={mode==='quick'?policy.min_principal:1} max={mode==='quick'?policy.max_principal:undefined} step="1" inputMode="numeric" value={principal} onChange={e=>setPrincipal(e.target.value)}/></label>
        {mode==='quick'?<label>Tenor<select value={weeks} onChange={e=>setWeeks(e.target.value)}>{rates.map(r=><option key={r.weeks} value={r.weeks}>{r.weeks} minggu, bunga {r.rateBps/100}%</option>)}</select></label>
          :<label>Tenor (minggu)<input required type="number" min="1" max="104" value={weeks} onChange={e=>setWeeks(e.target.value)}/></label>}
        {mode==='import'&&<>
          <label>Total bunga (Rp)<input type="number" min="0" step="1" inputMode="numeric" value={interest} placeholder={autoInterest?`${autoInterest} sesuai kebijakan`:'Isi bunga yang disepakati'} onChange={e=>setInterest(e.target.value)} required={!rate}/></label>
          <label>Tanggal dana dicairkan<input name="disbursedOn" type="date" required max={today}/></label>
          <label>Sudah dibayar sebelum hari ini (Rp)<input type="number" min="0" step="1" inputMode="numeric" value={paid} onChange={e=>setPaid(e.target.value)} placeholder="0"/></label></>}
      </fieldset>
      {preview&&<div className="manualPreview" aria-live="polite"><div><small>Total kewajiban</small><strong>{money(total)}</strong></div><div><small>Per minggu</small><strong>± {money(weekly)}</strong></div>
        {mode==='import'?<div><small>Sisa yang masuk ke aplikasi</small><strong>{money(remaining)}</strong></div>:<div><small>Bunga</small><strong>{money(loanInterest)}</strong></div>}</div>}
      <p className="muted">{mode==='quick'?(actor.role==='owner'?'Setelah disimpan Anda langsung diarahkan ke formulir "Cairkan dana". Angsuran pertama 7 hari setelah dana dikirim.':'Setelah disimpan, pemilik mencairkan dana. Angsuran pertama 7 hari setelah dana dikirim.')
        :'Pembayaran sebelum hari ini dicatat sebagai saldo awal: tidak mengubah kas aplikasi dan tidak dihitung sebagai uang masuk bulan ini. Denda keterlambatan dihitung mulai hari ini.'}</p>
      <button disabled={action.pending}>{action.pending?'Menyimpan…':mode==='quick'?'Simpan pinjaman':'Simpan pinjaman lama'}</button>
      {action.error&&<p className="error" role="alert">{action.error}</p>}
    </form>}
  </Shell>;
}
