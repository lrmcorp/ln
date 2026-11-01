'use client';
import {useRef,useState} from 'react';
import {money} from './Shell';

// Record a payment where the borrower is: photo of the receipt, amount read from it or typed, save. Works offline through the shared action queue.
export function QuickPay({applicationId,customer,suggested,remaining,role,pending,run,onClose}:{applicationId:string;customer:string;suggested:number;remaining:number;role:string;pending:boolean;
  run:(path:string,body:unknown,options:{success?:string;offline?:string;hash?:string})=>void;onClose:()=>void}){
  const [amount,setAmount]=useState('');
  const [source,setSource]=useState<'entered'|'read_confirmed'>('entered');
  const [note,setNote]=useState('');
  const [reading,setReading]=useState(false);
  const latest=useRef<File|null>(null);
  async function read(file:File|undefined){
    latest.current=file??null;setNote('');
    if(!file||file.type==='application/pdf'||amount)return;
    if(!navigator.onLine){setNote('Offline: isi nominal, atau biarkan kosong agar dibaca server saat online.');return;}
    setReading(true);
    try{
      const body=new FormData();body.set('applicationId',applicationId);body.set('receipt',file);
      const response=await fetch('/api/payments/read',{method:'POST',body});const result=await response.json();
      if(latest.current!==file)return;
      if(response.ok&&result.amount&&result.amount<=remaining){setAmount(String(result.amount));setSource('read_confirmed');setNote(`Terbaca dari bukti: ${money(result.amount)}. Periksa sebelum simpan.`);}
      else setNote('Nominal tidak terbaca. Isi sesuai bukti.');
    }catch{setNote('Bukti belum bisa dibaca. Isi nominal sesuai bukti.');}
    finally{if(latest.current===file)setReading(false);}
  }
  return <form className="quickPay" method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);f.set('applicationId',applicationId);f.set('amountSource',source);f.set('earlyPayoff','0');
      run('/api/payments',f,{success:'Pembayaran tersimpan.',offline:`Pembayaran ${customer}`});}}>
    <label>Foto bukti bayar<input name="receipt" type="file" accept="image/jpeg,image/png,application/pdf" capture="environment" required onChange={e=>read(e.target.files?.[0])}/></label>
    <label>Nominal (Rp)<input name="amount" type="number" min="1" max={remaining} inputMode="numeric" placeholder={reading?'Membaca bukti…':`${suggested} (kosongkan agar dibaca dari foto)`} value={amount} onChange={e=>{setAmount(e.target.value);setSource('entered');}}/></label>
    {note&&<p className="readNote" role="status">{note}</p>}
    <label>Cara bayar<select name="method" defaultValue={role==='officer'?'cash':'transfer'}><option value="cash">Tunai</option><option value="transfer">Transfer</option></select></label>
    <div className="quickPayActions"><button disabled={pending||reading}>{reading?'Membaca…':'Simpan pembayaran'}</button><button type="button" className="secondary" onClick={onClose}>Batal</button></div>
    <small className="muted">Sisa tagihan {money(remaining)}.{role==='officer'?' Diverifikasi manajer.':''}</small>
  </form>;
}
