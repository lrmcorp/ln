'use client';
import {useEffect,useRef,useState} from 'react';
import type {monthlyTerms} from '@/lib/terms';

type Preview={applicationId:string;customerName:string;quote:ReturnType<typeof monthlyTerms>};
const money=(value:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);

export default function SigningScreen({role,preview}:{role:'officer'|'customer';preview:Preview}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const drawing=useRef(false);
  const [drawn,setDrawn]=useState(false);
  const [name,setName]=useState('');
  const [accepted,setAccepted]=useState(false);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    const element=canvas.current;if(!element)return;
    const width=element.getBoundingClientRect().width;
    element.width=Math.round(width*devicePixelRatio);element.height=Math.round(180*devicePixelRatio);
    const context=element.getContext('2d');if(!context)return;
    context.scale(devicePixelRatio,devicePixelRatio);context.fillStyle='#fffefa';context.fillRect(0,0,width,180);
    context.lineWidth=2.5;context.lineCap='round';context.lineJoin='round';context.strokeStyle='#182521';
  },[]);
  function point(event:React.PointerEvent<HTMLCanvasElement>){const rect=event.currentTarget.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
  function down(event:React.PointerEvent<HTMLCanvasElement>){
    event.currentTarget.setPointerCapture(event.pointerId);drawing.current=true;
    const p=point(event),context=canvas.current?.getContext('2d');context?.beginPath();context?.moveTo(p.x,p.y);
  }
  function move(event:React.PointerEvent<HTMLCanvasElement>){if(!drawing.current)return;const p=point(event),context=canvas.current?.getContext('2d');context?.lineTo(p.x,p.y);context?.stroke();setDrawn(true);}
  function up(){drawing.current=false;}
  function clear(){const element=canvas.current;if(!element)return;const context=element.getContext('2d');if(!context)return;context.fillStyle='#fffefa';context.fillRect(0,0,element.width,element.height);context.strokeStyle='#182521';setDrawn(false);}
  async function submit(event:React.FormEvent){
    event.preventDefault();if(!drawn||!accepted||!canvas.current)return;
    setPending(true);setError('');
    try{
      const response=await fetch('/api/signing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({applicationId:preview.applicationId,
        signerName:name,accepted,termsHash:preview.quote.hash,signatureDataUrl:canvas.current.toDataURL('image/png')})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??'Tanda tangan gagal');
      window.location.assign(role==='officer'?`/?signed=1#case-${preview.applicationId}`:'/');
    }catch(cause){setError(cause instanceof Error?cause.message:'Tanda tangan gagal');setPending(false);}
  }
  const snapshot=preview.quote.snapshot;
  return <main className="signingPage"><div className="signingShell"><a className="signingBack" href="/">Kembali</a><p className="signingEyebrow">Langkah 3 · Nasabah membaca dan menandatangani</p><h1>Syarat pinjaman</h1>
    <div className="signingNotice">{role==='officer'?'Serahkan layar ini kepada nasabah. Petugas tidak boleh menggambar tanda tangan untuk nasabah.':'Baca seluruh syarat sebelum menandatangani pada perangkat Anda.'} Tanda tangan ini hanya simulasi pengembangan, belum sah untuk pinjaman nyata.</div>
    <section className="termsSummary" aria-label="Ringkasan kewajiban"><div><small>Pokok</small><strong>{money(snapshot.principal)}</strong></div><div><small>Bunga total</small><strong>{money(snapshot.interest)}</strong></div><div><small>Total pokok dan bunga</small><strong>{money(snapshot.total)}</strong></div><div><small>Angsuran</small><strong>{snapshot.months} bulan, setiap tanggal 1</strong></div></section>
    <section className="termsSection"><h2>Jadwal pembayaran</h2><div className="schedule"><table><thead><tr><th>Tanggal 1</th><th>Pokok</th><th>Bunga</th><th>Jumlah</th></tr></thead><tbody>{snapshot.schedule.map(item=><tr key={item.sequence}><td>{new Date(`${item.dueAt}T12:00:00Z`).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})}</td><td>{money(item.principal)}</td><td>{money(item.interest)}</td><td>{money(item.principal+item.interest)}</td></tr>)}</tbody></table></div></section>
    <section className="termsSection"><h2>Ketentuan dalam bahasa Indonesia</h2>{preview.quote.terms.map((paragraph,index)=><p key={index}>{paragraph}</p>)}</section>
    <form className="signingForm" method="post" onSubmit={submit}><h2>Tanda tangan nasabah</h2><label>Nama lengkap sesuai KTP<input required value={name} onChange={event=>setName(event.target.value)} autoComplete="name"/></label><div><span className="signatureLabel">Gambar tanda tangan di kotak ini</span><canvas ref={canvas} className="signatureCanvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Area gambar tanda tangan"/><button className="textButton" type="button" onClick={clear}>Hapus gambar</button></div><label className="signingCheck"><input type="checkbox" checked={accepted} onChange={event=>setAccepted(event.target.checked)}/><span>Saya telah membaca jadwal, bunga, denda keterlambatan, dan seluruh ketentuan di atas. Saya setuju menandatangani versi ini.</span></label><button disabled={pending||!accepted||!drawn}>{pending?'Menyimpan…':'Tandatangani syarat'}</button>{error&&<p className="error" role="alert">{error}</p>}</form>
  </div></main>;
}
