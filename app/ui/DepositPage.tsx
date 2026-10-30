'use client';
import {Shell,StatusChip,money,shortDate,useAction,type StaffActor} from './Shell';

type Data={today:string;expectedToday:number;history:{id:string;deposit_date:string;amount:string;expected:string;status:string;review_note:string|null}[];undeposited:{day:string;total:number}[]};
const statusLabel:Record<string,{label:string;tone:'pending'|'ok'|'late'}>={pending:{label:'Menunggu konfirmasi',tone:'pending'},confirmed:{label:'Dikonfirmasi',tone:'ok'},rejected:{label:'Ditolak, kirim ulang',tone:'late'}};

export default function DepositPage({actor,data}:{actor:StaffActor;data:Data}){
  const action=useAction();
  const owed=data.undeposited.reduce((sum,row)=>sum+row.total,0);
  const defaultDay=data.undeposited.at(-1)?.day??data.today;
  return <Shell actor={actor} active="setoran">
    <div className="intro"><div><h1>Setoran kas</h1><p>Setor tunai yang Anda tagih ke rekening perusahaan setiap hari, lalu unggah bukti setornya.</p></div></div>
    <section className="focusPanel" aria-label="Fokus saat ini"><div><small>Tunai belum disetor</small><strong>{money(owed)}{data.undeposited.length>1?` dari ${data.undeposited.length} hari`:''}</strong></div><div className="weekTarget"><small>Belum disetor dari hari ini</small><strong>{money(data.expectedToday)}</strong></div></section>
    <section className="newPanel"><div><h2>Kirim setoran</h2><p>Setor sisa tunai per tanggal tagih. Jika setoran kurang, kirim setoran tambahan; selisih terlihat oleh manajer.</p>
      {data.undeposited.length>0&&<ul className="plainList">{data.undeposited.map(row=><li key={row.day}>{shortDate(row.day)}: {money(row.total)}</li>)}</ul>}</div>
      <form method="post" onSubmit={e=>{e.preventDefault();action.run('/api/deposits',new FormData(e.currentTarget),{success:'Setoran terkirim. Menunggu konfirmasi manajer.'});}}>
        <label>Tanggal tagih<input name="date" type="date" max={data.today} defaultValue={defaultDay} required/></label>
        <label>Jumlah disetor (Rp)<input name="amount" type="number" min="0" defaultValue={data.undeposited.find(row=>row.day===defaultDay)?.total??''} required/></label>
        <label>Foto atau PDF bukti setor<input name="proof" type="file" accept="image/jpeg,image/png,application/pdf" required/></label>
        <button disabled={action.pending}>Kirim setoran</button></form></section>
    <section className="register"><div className="sectionHead"><div><h2>Riwayat setoran</h2></div></div>
      {data.history.length===0?<div className="empty">Belum ada setoran.</div>:<div className="paymentList"><ul>{data.history.map(h=>{const diff=Number(h.amount)-Number(h.expected);
        return <li key={h.id}><span><StatusChip tone={statusLabel[h.status].tone}>{statusLabel[h.status].label}</StatusChip> {shortDate(h.deposit_date)} · disetor {money(h.amount)} · tercatat {money(h.expected)}{diff?` · selisih ${money(diff)}`:''}{h.review_note?` · ${h.review_note}`:''}</span><a href={`/api/deposits/${h.id}/proof`} target="_blank" rel="noopener noreferrer">Bukti</a></li>;})}</ul></div>}</section>
    {action.feedback}
  </Shell>;
}
