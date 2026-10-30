'use client';
import {PageHeader,Shell,StatusChip,displayName,money,shortDate,type StaffActor} from './Shell';
import type {customerProfile} from '@/lib/customers';
import {whatsappLink} from '@/lib/whatsapp';

type Profile=Awaited<ReturnType<typeof customerProfile>>;
const statusLabels:Record<string,string>={submitted:'Menunggu keputusan',awaiting_signature:'Menunggu tanda tangan',signed_pending_approval:'Menunggu persetujuan',approved:'Disetujui',signed:'Siap dicairkan',
  release_authorized:'Siap dicairkan',transfer_initiated:'Transfer dimulai',active:'Aktif',paid_off:'Lunas',closed:'Ditutup',written_off:'Dihapusbukukan',rejected:'Ditolak'};
const visitLabels:Record<string,string>={paid:'Bertemu, sudah bayar',promise:'Janji bayar',not_home:'Tidak di rumah',refused:'Menolak bayar',other:'Lainnya'};
const gradeTone={A:'ok',B:'neutral',C:'due',D:'late',Baru:'neutral'} as const;

export default function CustomerPage({actor,profile}:{actor:StaffActor;profile:Profile}){
  const {customer,grade,loans,payments,visits}=profile;
  const name=displayName(customer.name);
  const active=loans.find(loan=>loan.status==='active');
  const wa=whatsappLink(customer.phone,`Halo ${name}, ini dari LN.`);
  const completed=loans.filter(loan=>['paid_off','closed'].includes(loan.status)).length;
  return <Shell actor={actor} active="pinjaman">
    <PageHeader title={name} subtitle={<>{customer.branch} · nasabah sejak {shortDate(customer.since)}</>}
      actions={<>{customer.phone&&<a className="button secondary" href={`tel:${customer.phone.replace(/[^\d+]/g,'')}`}>Telepon</a>}{wa&&<a className="button secondary" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
        {active&&<a className="button" href={`/pinjaman#case-${active.id}`}>{actor.role==='owner'?'Buka pinjaman aktif':'Catat bayar'}</a>}</>}/>
    <div className="cardGrid profileTop">
      <section className="card"><div className="cardHead"><h2>Kelas nasabah</h2></div>
        <div className="meterTop"><strong>{grade.grade==='Baru'?'Baru':`Kelas ${grade.grade}`}</strong><StatusChip tone={gradeTone[grade.grade]}>{grade.label}</StatusChip></div>
        <dl className="rows"><div><dt>Pinjaman selesai</dt><dd>{completed}</dd></div><div><dt>Total pinjaman</dt><dd>{loans.length}</dd></div>
          <div><dt>Pendapatan per minggu</dt><dd>{money(customer.weeklyIncome)}</dd></div></dl></section>
      <section className="card"><div className="cardHead"><h2>Pinjaman berjalan</h2></div>
        {active?<><div className="meterTop"><strong>{money(active.remaining)}</strong><span className="muted">sisa</span></div>
          <dl className="rows"><div><dt>Pokok</dt><dd>{money(active.principal)}</dd></div><div><dt>Sudah dibayar</dt><dd>{money(active.paid)}</dd></div>
            <div><dt>Penagih</dt><dd>{displayName(active.collector??'-')}</dd></div><div><dt>Terlambat terlama</dt><dd>{active.max_dpd} hari</dd></div></dl></>
          :<p className="emptyLine">Tidak ada pinjaman aktif.</p>}</section>
      <section className="card"><div className="cardHead"><h2>Kunjungan terakhir</h2></div>
        {visits[0]?<><p className="emptyLine"><strong>{visitLabels[visits[0].outcome]}</strong>{visits[0].promise_date?` · janji ${shortDate(visits[0].promise_date)}`:''}</p>
          <p className="muted">{shortDate(visits[0].created_at)} oleh {displayName(visits[0].officer)}{visits[0].note?` · ${visits[0].note}`:''}</p></>:<p className="emptyLine">Belum ada kunjungan.</p>}</section>
    </div>
    <section className="register"><div className="sectionHead"><div><h2>Riwayat pinjaman</h2></div></div>
      <div className="schedule reportTable"><table><thead><tr><th>Diajukan</th><th>Status</th><th>Pokok</th><th>Bunga</th><th>Tenor</th><th>Dibayar</th><th>Sisa</th><th>Terlambat terlama</th><th></th></tr></thead>
        <tbody>{loans.map(loan=><tr key={loan.id}><td>{shortDate(loan.submitted)}</td><td>{statusLabels[loan.status]??loan.status}</td><td>{money(loan.principal)}</td><td>{money(loan.interest)}</td>
          <td>{loan.term_weeks?`${loan.term_weeks} minggu`:'-'}</td><td>{money(loan.paid)}</td><td>{money(loan.remaining)}</td><td>{loan.max_dpd} hari</td><td><a href={`/pinjaman#case-${loan.id}`}>Buka</a></td></tr>)}</tbody></table></div></section>
    <section className="register"><div className="sectionHead"><div><h2>Pembayaran</h2><p>{payments.length} terakhir</p></div></div>
      {payments.length===0?<div className="empty">Belum ada pembayaran.</div>:<div className="paymentList"><ul>{payments.map(p=><li key={p.id}><span>
        <StatusChip tone={p.status==='verified'?'ok':p.status==='pending'?'pending':'late'}>{p.status==='verified'?'Terverifikasi':p.status==='pending'?'Menunggu verifikasi':'Ditolak'}</StatusChip> {shortDate(p.created_at)} · {money(p.amount)} · {p.method==='cash'?'tunai':'transfer'} · {displayName(p.recorded_by)}{p.review_note?` · ${p.review_note}`:''}</span>
        {actor.role!=='officer'&&<a href={`/api/payments/${p.id}/receipt`} target="_blank" rel="noopener noreferrer">Lihat bukti</a>}</li>)}</ul></div>}</section>
    <section className="register"><div className="sectionHead"><div><h2>Kunjungan</h2></div></div>
      {visits.length===0?<div className="empty">Belum ada kunjungan.</div>:<div className="paymentList"><ul>{visits.map(v=><li key={v.id}><span>{shortDate(v.created_at)} · <strong>{visitLabels[v.outcome]}</strong>{v.promise_date?` ${shortDate(v.promise_date)}`:''} · {displayName(v.officer)}{v.note?` · ${v.note}`:''}</span></li>)}</ul></div>}</section>
  </Shell>;
}
