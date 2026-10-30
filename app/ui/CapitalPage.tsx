'use client';
import {Shell,money,shortDate,useAction,type StaffActor} from './Shell';
import type {capitalReport} from '@/lib/admin';

type Report=Awaited<ReturnType<typeof capitalReport>>;
const kinds:Record<string,string>={injection:'Setoran modal',withdrawal:'Penarikan modal',distribution:'Bagi hasil'};

export default function CapitalPage({actor,report,today}:{actor:StaffActor;report:Report;today:string}){
  const action=useAction();
  return <Shell actor={actor} active="modal">
    <div className="intro"><div><h1>Modal dan investor</h1><p>Dari mana dana berasal, berapa yang sedang dipinjamkan, dan hasilnya. Dipakai untuk laporan bulanan ke investor.</p></div></div>
    <section className="metrics" aria-label="Posisi modal"><div><small>Modal tercatat</small><strong>{money(report.capital)}</strong><span>Pemilik dan investor</span></div>
      <div><small>Dipinjamkan</small><strong>{money(report.deployed)}</strong><span>{report.utilisation}% dari modal</span></div>
      <div><small>Kas menganggur</small><strong>{money(report.idleCash)}</strong><span>{report.inTransit?`+ ${money(report.inTransit)} tunai di petugas`:'Tidak ada tunai di petugas'}</span></div>
      <div><small>Hasil bersih (tahunan)</small><strong>{report.annualYield}%</strong><span>Bulan terakhir dibanding dana dipinjamkan</span></div></section>
    <section className="newPanel"><div><h2>Catat pergerakan modal</h2><p>Setoran menambah kas. Penarikan dan bagi hasil mengurangi kas dan ditolak jika kas tidak cukup. Biaya modal tahunan dipakai untuk membandingkan hasil.</p></div>
      <form method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);action.run('/api/ops',{type:'record_capital',kind:String(f.get('kind')),source:String(f.get('source')),sourceType:String(f.get('sourceType')),
        amount:Number(f.get('amount')),annualCostBps:Math.round(Number(f.get('cost')||0)*100),date:String(f.get('date')),note:String(f.get('note')??'')},{success:'Pergerakan modal tercatat.'});}}>
        <label>Jenis<select name="kind" defaultValue="injection"><option value="injection">Setoran modal</option><option value="withdrawal">Penarikan modal</option><option value="distribution">Bagi hasil</option></select></label>
        <label>Sumber<select name="sourceType" defaultValue="owner"><option value="owner">Pemilik</option><option value="investor">Investor</option></select></label>
        <label>Nama pemilik atau investor<input name="source" required maxLength={100}/></label><label>Jumlah (Rp)<input name="amount" type="number" min="1" required/></label>
        <label>Biaya modal per tahun (%)<input name="cost" type="number" min="0" max="100" step="0.1" defaultValue={0}/></label><label>Tanggal<input name="date" type="date" max={today} defaultValue={today} required/></label>
        <label>Catatan (opsional)<input name="note" maxLength={500}/></label><button disabled={action.pending}>Simpan</button></form></section>
    <Table title="Per sumber dana" head={['Sumber','Jenis','Modal bersih','Sudah dibagi','Biaya per tahun']} rows={report.sources.map(s=>[s.source,s.type==='owner'?'Pemilik':'Investor',money(s.net),money(s.distributed),`${s.costBps/100}%`])}/>
    <Table title="Ringkasan bulanan" head={['Bulan','Dicairkan','Tertagih','Pendapatan','Cadangan dan hapus buku','Hasil bersih']}
      rows={report.monthly.map(m=>[m.month,money(m.disbursed),money(m.collected),money(m.income),money(m.losses),money(m.net)])}/>
    <section className="metrics compact" aria-label="Laba rugi kumulatif"><div><small>Pendapatan bunga</small><strong>{money(report.ledger.interestIncome)}</strong><span>Diakui saat angsuran jatuh tempo</span></div>
      <div><small>Pendapatan denda</small><strong>{money(report.ledger.feeIncome)}</strong><span>Denda keterlambatan</span></div>
      <div><small>Cadangan kerugian</small><strong>{money(report.ledger.allowance)}</strong><span>Saldo saat ini</span></div>
      <div><small>Bunga belum diakui</small><strong>{money(report.ledger.unearned)}</strong><span>Akan diakui per minggu</span></div></section>
    <Table title="Riwayat pergerakan modal" head={['Tanggal','Jenis','Sumber','Jumlah','Dicatat','Catatan']} rows={report.movements.map(m=>[shortDate(m.date),kinds[m.kind],m.source,money(m.amount),m.recorded_by,m.note??''])}/>
    {action.feedback}
  </Shell>;
}

function Table({title,head,rows}:{title:string;head:string[];rows:(string|number)[][]}){
  return <section className="register"><div className="sectionHead"><div><h2>{title}</h2></div></div>
    {rows.length===0?<div className="empty">Belum ada data.</div>:<div className="schedule reportTable"><table><thead><tr>{head.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}</section>;
}
