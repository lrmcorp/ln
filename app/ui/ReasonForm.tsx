'use client';
import {useState} from 'react';

// A "Tolak" button that opens an inline form: pick a common reason, optionally add detail, confirm. Replaces the browser prompt.
export function ReasonForm({label='Tolak',reasons,pending,onSubmit}:{label?:string;reasons:string[];pending:boolean;onSubmit:(reason:string)=>void}){
  const [open,setOpen]=useState(false);
  const [reason,setReason]=useState(reasons[0]);
  const [detail,setDetail]=useState('');
  if(!open)return <button type="button" className="danger" disabled={pending} onClick={()=>setOpen(true)}>{label}</button>;
  const other=reason==='Lainnya';
  return <form className="reasonForm" onSubmit={e=>{e.preventDefault();const text=other?detail.trim():[reason,detail.trim()].filter(Boolean).join(': ');if(text)onSubmit(text);}}>
    <label>Alasan<select value={reason} onChange={e=>setReason(e.target.value)}>{reasons.map(r=><option key={r}>{r}</option>)}</select></label>
    <label>{other?'Tulis alasannya':'Keterangan (opsional)'}<input value={detail} onChange={e=>setDetail(e.target.value)} maxLength={400} required={other}/></label>
    <div className="reasonActions"><button className="danger" disabled={pending}>{label}</button><button type="button" className="secondary" onClick={()=>setOpen(false)}>Batal</button></div>
  </form>;
}
