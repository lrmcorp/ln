'use client';
import {PageHeader,Shell,StatusChip,displayName,money,shortDate,type StaffActor} from './Shell';
import type {portfolioReport} from '@/lib/reports';

type Report=Awaited<ReturnType<typeof portfolioReport>>;

export default function ReportPage({actor,report,officers,branches,filter}:{actor:StaffActor;report:Report;officers:{id:string;name:string}[];branches:{id:string;name:string}[];filter:{branchId:string;collectorId:string}}){
  const query=new URLSearchParams();if(filter.branchId)query.set('cabang',filter.branchId);if(filter.collectorId)query.set('penagih',filter.collectorId);
  const csv=(kind:string)=>`/api/reports/csv?kind=${kind}${query.size?`&${query}`:''}`;
  const par=[{label:'Terlambat 1+ hari',data:report.par1},{label:'Terlambat 7+ hari',data:report.par7},{label:'Terlambat 30+ hari',data:report.par30}];
  return <Shell actor={actor} active="laporan">
    <PageHeader title="Laporan portofolio" subtitle={`Per ${shortDate(report.today)} · Kesehatan pinjaman, tagihan minggu ini, arus kas, dan kinerja penagih dari buku besar.`}/>
    <form className="filterBar" method="get">{actor.role==='owner'&&<label>Cabang<select name="cabang" defaultValue={filter.branchId}><option value="">Semua cabang</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      <label>Penagih<select name="penagih" defaultValue={filter.collectorId}><option value="">Semua penagih</option>{officers.map(o=><option key={o.id} value={o.id}>{displayName(o.name)}</option>)}</select></label><button className="secondary">Terapkan</button></form>
    <section className="metrics" aria-label="Indikator utama"><div><small>Pokok beredar</small><strong>{money(report.outstanding)}</strong><span>{report.activeCount} pinjaman aktif</span></div>
      {par.map(p=><div key={p.label} className={p.data.percent>=10?'metricAlert':undefined}><small>{p.label} (PAR)</small><strong>{p.data.percent}%</strong><span>{p.data.count} pinjaman · {money(p.data.amount)}</span></div>)}
      <div><small>Tingkat tagih minggu ini</small><strong>{report.week.rate}%</strong><span>{money(report.week.collected)} dari {money(report.week.due)}</span></div></section>
    <p className="reportNote">PAR = porsi pokok beredar dari pinjaman yang terlambat; di atas 10% ditandai merah. Tingkat tagih = bagian angsuran jatuh tempo {shortDate(report.week.start)} sampai {shortDate(report.week.end)} yang sudah dibayar. Total uang masuk minggu ini, termasuk pelunasan dan angsuran di muka: {money(report.week.received)}.</p>
    <ReportTable title="Kinerja penagih" csv={csv('petugas')} head={['Penagih','Pinjaman aktif','Pokok beredar','Terlambat 7+','Jatuh tempo minggu ini','Tertagih','Tingkat tagih','Belum diverifikasi']}
      rows={report.officers.map(o=>[`${displayName(o.name)}${actor.role==='owner'?` · ${o.branch}`:''}`,o.active,money(o.outstanding),o.par7,money(o.due),money(o.collected),`${o.rate}%`,o.pending])}/>
    <ReportTable title="Arus kas mingguan" csv={csv('arus-kas')} note="8 minggu terakhir dan perkiraan 4 minggu ke depan dari jadwal angsuran yang belum dibayar."
      head={['Minggu mulai','Dicairkan','Tertagih','Perkiraan masuk']} rows={report.cashflow.map(w=>[`${shortDate(w.week)}${w.future?' (perkiraan)':''}`,money(w.disbursed),w.future?'-':money(w.collected),w.expected?money(w.expected):'-'])}/>
    <ReportTable title="Vintage per minggu pencairan" csv={csv('vintage')} note="Berapa banyak dari setiap angkatan pinjaman yang sudah tertagih, terlambat, atau dihapusbukukan."
      head={['Minggu cair','Pinjaman','Dicairkan','Total kewajiban','Tertagih','Tertagih %','Terlambat','Lunas','Hapus buku']}
      rows={report.vintage.map(v=>[shortDate(v.week),v.loans,money(v.disbursed),money(v.due),money(v.collected),`${v.repaidPercent}%`,v.late,v.paidOff,v.writtenOff])}/>
    <section className="register"><div className="sectionHead"><div><h2>Pinjaman terlambat</h2><p>Urut dari yang paling lama</p></div><a className="pillAction" href={csv('pinjaman')}>Unduh semua pinjaman (Excel)</a></div>
      {report.loans.filter(l=>l.dpd>0).length===0?<div className="empty">Tidak ada pinjaman terlambat.</div>:<div className="paymentList"><ul>{report.loans.filter(l=>l.dpd>0).sort((a,b)=>b.dpd-a.dpd).map(l=>
        <li key={l.id}><span><StatusChip tone="late">{l.dpd} hari</StatusChip> {displayName(l.customer)} · sisa {money(l.receivable)} · {displayName(l.collector)}</span><a href={`/pinjaman#case-${l.id}`}>Buka</a></li>)}</ul></div>}</section>
  </Shell>;
}

function ReportTable({title,head,rows,csv,note}:{title:string;head:string[];rows:(string|number)[][];csv:string;note?:string}){
  return <section className="register"><div className="sectionHead"><div><h2>{title}</h2>{note&&<p>{note}</p>}</div><a className="pillAction" href={csv}>Unduh Excel</a></div>
    {rows.length===0?<div className="empty">Belum ada data.</div>:<div className="schedule reportTable"><table><thead><tr>{head.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}</section>;
}
