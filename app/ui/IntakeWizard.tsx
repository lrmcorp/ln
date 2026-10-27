'use client';
import {useState} from 'react';
import {calculateFlatSchedule} from '@/lib/finance';

type Policy={version:number;min_principal:string;max_principal:string;late_fee_monthly_bps:number;weekly_rates:{weeks:number;rateBps:number}[]};
const money=(amount:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(amount);
type Fields={name:string;nik:string;dateOfBirth:string;phone:string;address:string;motherName:string;bankName:string;bankAccountNumber:string;accountHolder:string;occupation:string;loanPurpose:string};
const empty:Fields={name:'',nik:'',dateOfBirth:'',phone:'',address:'',motherName:'',bankName:'',bankAccountNumber:'',accountHolder:'',occupation:'',loanPurpose:''};

export default function IntakeWizard({policy}:{policy:Policy}){
  const [step,setStep]=useState(1);
  const [fields,setFields]=useState(empty);
  const [ktp,setKtp]=useState<File|null>(null);
  const [liveness,setLiveness]=useState<File|null>(null);
  const [principal,setPrincipal]=useState('');
  const [weeks,setWeeks]=useState(String(policy.weekly_rates[0]?.weeks??''));
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  function field(name:keyof Fields){return {value:fields[name],onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>setFields(current=>({...current,[name]:event.target.value}))};}
  const amount=Number(principal),rate=policy.weekly_rates.find(item=>String(item.weeks)===weeks);
  const validQuote=Number.isSafeInteger(amount)&&!!rate&&amount>=Number(policy.min_principal)&&amount<=Number(policy.max_principal);
  const quote=validQuote&&rate?calculateFlatSchedule(amount,rate.rateBps,rate.weeks,new Date(0)):null;
  async function save(event:React.FormEvent){
    event.preventDefault();if(!ktp||!liveness||!quote)return;
    setPending(true);setError('');
    try{
      const body=new FormData();
      for(const [key,value] of Object.entries(fields))body.set(key,value);
      body.set('principal',principal);body.set('weeks',weeks);body.set('ktp',ktp);body.set('liveness',liveness);
      const response=await fetch('/api/intake',{method:'POST',body});
      const result=await response.json();if(!response.ok)throw new Error(result.error??'Pengajuan gagal');
      window.location.assign(`/tanda-tangan/${result.id}`);
    }catch(cause){
      const message=cause instanceof Error?cause.message:'Pengajuan gagal';
      setError(message);setPending(false);
      if(message==='NIK sudah terdaftar'){setStep(1);requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('input[name=nik]')?.focus());}
    }
  }
  return <main className="intakePage"><div className="intakeShell"><a href="/" className="signingBack">Kembali ke daftar pinjaman</a><div className="intakeHeading"><small>Petugas lapangan · Langkah {step} dari 3</small><h1>Pengajuan baru</h1><p>{step===1?'Catat identitas dan bukti nasabah.':'Perlihatkan rincian pinjaman sebelum nasabah menandatangani.'}</p></div>
    <div className="intakeProgress" aria-label={`Langkah ${step} dari 3`}><span className="current">1. Data & bukti</span><span className={step===2?'current':''}>2. Jumlah & jadwal</span><span>3. Tanda tangan</span></div>
    {step===1?<form method="post" className="intakeForm" onSubmit={event=>{event.preventDefault();if(!ktp||!liveness){setError('Foto KTP dan video tantangan wajib diisi');return;}setError('');setStep(2);window.scrollTo(0,0);}}>
      <h2>Identitas nasabah</h2><div className="intakeGrid"><label>Nama sesuai KTP<input required maxLength={200} {...field('name')}/></label><label>NIK 16 digit<input name="nik" required inputMode="numeric" pattern="[0-9]{16}" {...field('nik')}/></label><label>Tanggal lahir<input required type="date" {...field('dateOfBirth')}/></label><label>Nama ibu kandung<input required maxLength={200} {...field('motherName')}/></label><label>Nomor telepon<input required type="tel" {...field('phone')}/></label><label>Alamat tempat tinggal<textarea required maxLength={500} {...field('address')}/></label></div>
      <h2>Rekening pencairan</h2><div className="intakeGrid"><label>Nama bank<input required {...field('bankName')}/></label><label>Nomor rekening<input required inputMode="numeric" pattern="[0-9]{5,30}" {...field('bankAccountNumber')}/></label><label>Nama pemilik rekening<input required {...field('accountHolder')}/></label></div>
      <h2>Bukti identitas</h2><p className="intakeNote">Gunakan hanya data rekaan dalam demo. Berkas disimpan terenkripsi. Video tantangan belum diverifikasi otomatis dan harus ditinjau manual.</p><div className="intakeGrid"><label>Foto depan KTP (JPG/PNG, maksimal 4 MB)<input required={!ktp} type="file" accept="image/jpeg,image/png" capture="environment" onChange={event=>setKtp(event.target.files?.[0]??null)}/>{ktp&&<small>Tersimpan untuk pengajuan ini: {ktp.name}</small>}</label><label>Video wajah menoleh kiri dan kanan (MP4/WebM, maksimal 12 MB)<input required={!liveness} type="file" accept="video/mp4,video/webm" capture="user" onChange={event=>setLiveness(event.target.files?.[0]??null)}/>{liveness&&<small>Tersimpan untuk pengajuan ini: {liveness.name}</small>}</label></div><div className="intakeGrid"><label>Pekerjaan atau sumber penghasilan (opsional)<input maxLength={200} {...field('occupation')}/></label><label>Tujuan pinjaman (opsional)<input maxLength={300} {...field('loanPurpose')}/></label></div>
      {error&&<p className="error" role="alert">{error}</p>}<button>Lanjut ke jumlah</button>
    </form>:<form method="post" className="intakeForm" onSubmit={save}><h2>Jumlah dan tenor</h2><p>Kebijakan versi {policy.version}. Bunga tetap di atas pokok sesuai tenor. Cicilan mingguan dimulai 7 hari setelah pemilik menyetujui pinjaman.</p><div className="intakeGrid"><label>Pokok pinjaman (Rp)<input required type="number" min={policy.min_principal} max={policy.max_principal} step="1" value={principal} onChange={event=>setPrincipal(event.target.value)}/></label></div>
      <fieldset className="tenorChoice"><legend>Tenor</legend>{policy.weekly_rates.map(item=><label key={item.weeks}><input type="radio" name="weeks" value={item.weeks} checked={weeks===String(item.weeks)} onChange={event=>setWeeks(event.target.value)}/><span><strong>{item.weeks} minggu</strong><small>Bunga {item.rateBps/100}%</small></span></label>)}</fieldset>
      {quote&&rate&&<section className="intakeQuote" aria-label="Pratinjau cicilan"><h3>{money(quote.installments[0].principal+quote.installments[0].interest)} per minggu</h3><p>Pokok {money(amount)} + bunga {rate.rateBps/100}% {money(quote.interest)} = <strong>{money(quote.total)}</strong>, dibayar {rate.weeks} kali.</p><div className="schedule"><table><thead><tr><th>Angsuran</th><th>Pokok</th><th>Bunga</th><th>Jumlah</th></tr></thead><tbody>{quote.installments.map(item=><tr key={item.sequence}><td>Minggu ke-{item.sequence}</td><td>{money(item.principal)}</td><td>{money(item.interest)}</td><td>{money(item.principal+item.interest)}</td></tr>)}</tbody></table></div><p>Nasabah membaca seluruh syarat pada langkah berikutnya.</p></section>}
      {error&&<p className="error" role="alert">{error}</p>}<div className="intakeButtons"><button type="button" className="textButton" onClick={()=>{setStep(1);window.scrollTo(0,0);}}>Ubah data</button><button disabled={pending||!quote}>{pending?'Menyimpan…':'Simpan dan lanjut ke tanda tangan'}</button></div>
    </form>}
  </div></main>;
}
