'use client';
import {ReasonForm} from './ReasonForm';
import {PageHeader,Shell,StatusChip,displayName,money,shortDate,useAction,type StaffActor} from './Shell';

type Queue={payments:{id:string;application_id:string;amount:string;method:string;amount_source:string;bank_reference:string|null;created_at:string;early_payoff:boolean;own:boolean;customer_name:string;recorded_by:string;branch_name:string}[];
  deposits:{id:string;deposit_date:string;amount:string;expected:string;created_at:string;officer_name:string;branch_name:string}[];
  recent:{id:string;amount:string;status:string;reviewed_at:string;review_note:string|null;customer_name:string;reviewer:string}[]};

export default function VerificationQueue({actor,queue}:{actor:StaffActor;queue:Queue}){
  const action=useAction();
  function reject(type:'reject_payment'|'review_deposit',id:string,note:string){
    action.run('/api/ops',type==='reject_payment'?{type,paymentId:id,note}:{type,depositId:id,approve:false,note},{success:'Ditolak.'});
  }
  return <Shell actor={actor} active="verifikasi">
    <PageHeader title="Verifikasi" subtitle="Cocokkan bukti dengan mutasi bank atau kas yang diterima. Pencatat tidak dapat memverifikasi catatannya sendiri."/>
    <section className="focusPanel" aria-label="Fokus saat ini"><div><small>Menunggu verifikasi</small><strong>{queue.payments.length} pembayaran · {queue.deposits.length} setoran kas</strong></div></section>
    <section className="register" aria-labelledby="pending-payments"><div className="sectionHead"><div><h2 id="pending-payments">Pembayaran</h2><p>Dicatat petugas atau dibaca otomatis dari bukti</p></div></div>
      {queue.payments.length===0?<div className="empty">Tidak ada pembayaran yang menunggu.</div>:<div className="caseList">{queue.payments.map(p=><article key={p.id} className="case"><div className="caseTop"><div>
          {p.amount_source==='read_auto'&&<StatusChip tone="due">Nominal dibaca otomatis</StatusChip>}{p.early_payoff&&<StatusChip tone="neutral">Pelunasan dipercepat</StatusChip>}
          <h3>{displayName(p.customer_name)}</h3><p>{shortDate(p.created_at)} · {p.method==='cash'?'Tunai':'Transfer'} · dicatat {displayName(p.recorded_by)}{p.bank_reference?` · Ref ${p.bank_reference}`:''}{actor.role==='owner'?` · ${p.branch_name}`:''}</p></div>
          <div className="caseAmount"><small>Nominal</small><strong>{money(p.amount)}</strong><a href={`/api/payments/${p.id}/receipt`} target="_blank" rel="noopener noreferrer">Lihat bukti</a></div></div>
        <div className="dueActions">{p.own?<p>Dicatat oleh Anda; perlu diverifikasi orang lain.</p>:<><button disabled={action.pending} onClick={()=>action.run('/api/ops',{type:'verify_payment',paymentId:p.id},{success:'Terverifikasi.'})}>Verifikasi</button>
          <ReasonForm reasons={['Nominal tidak sesuai mutasi','Transfer tidak ditemukan di rekening','Bukti tidak terbaca','Bukti sudah pernah dipakai','Lainnya']} pending={action.pending} onSubmit={note=>reject('reject_payment',p.id,note)}/></>}<a className="pillAction" href={`/pinjaman#case-${p.application_id}`}>Buka pinjaman</a></div></article>)}</div>}
    </section>
    <section className="register" aria-labelledby="pending-deposits"><div className="sectionHead"><div><h2 id="pending-deposits">Setoran kas petugas</h2><p>Tunai yang ditagih petugas harus disetor setiap hari</p></div></div>
      {queue.deposits.length===0?<div className="empty">Tidak ada setoran yang menunggu.</div>:<div className="caseList">{queue.deposits.map(d=>{const diff=Number(d.amount)-Number(d.expected);
        return <article key={d.id} className="case"><div className="caseTop"><div>{diff<0?<StatusChip tone="late">Kurang {money(-diff)}</StatusChip>:diff>0?<StatusChip tone="due">Lebih {money(diff)}</StatusChip>:<StatusChip tone="ok">Sesuai</StatusChip>}
            <h3>{displayName(d.officer_name)}</h3><p>Tanggal tagih {shortDate(d.deposit_date)} · tunai tercatat {money(d.expected)}{actor.role==='owner'?` · ${d.branch_name}`:''}</p></div>
            <div className="caseAmount"><small>Disetor</small><strong>{money(d.amount)}</strong><a href={`/api/deposits/${d.id}/proof`} target="_blank" rel="noopener noreferrer">Lihat bukti setor</a></div></div>
          <div className="dueActions"><button disabled={action.pending} onClick={()=>action.run('/api/ops',{type:'review_deposit',depositId:d.id,approve:true},{success:'Setoran dikonfirmasi.'})}>Konfirmasi setoran</button>
            <ReasonForm reasons={['Jumlah tidak sesuai bukti setor','Setoran tidak masuk rekening','Bukti tidak terbaca','Lainnya']} pending={action.pending} onSubmit={note=>reject('review_deposit',d.id,note)}/></div></article>;})}</div>}
    </section>
    {queue.recent.length>0&&<section className="register"><div className="sectionHead"><div><h2>Terakhir ditinjau</h2></div></div><div className="paymentList"><ul>{queue.recent.map(r=><li key={r.id}><span><StatusChip tone={r.status==='verified'?'ok':'late'}>{r.status==='verified'?'Terverifikasi':'Ditolak'}</StatusChip> {displayName(r.customer_name)} · {money(r.amount)} · {displayName(r.reviewer)} · {shortDate(r.reviewed_at)}{r.review_note?` · ${r.review_note}`:''}</span></li>)}</ul></div></section>}
    {action.feedback}
  </Shell>;
}
