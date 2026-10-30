'use client';
import {PageHeader,Shell,StatusChip,displayName,money,shortDate,type StaffActor} from './Shell';
import type {portfolioReport} from '@/lib/reports';
import type {profitReport} from '@/lib/profit';

const pc=(v:number)=>`${v.toLocaleString('id-ID')}%`;
type Report=Awaited<ReturnType<typeof portfolioReport>>;
type Profit=Awaited<ReturnType<typeof profitReport>>;

export default function ReportPage({actor,report,profit,officers,branches,filter}:{actor:StaffActor;report:Report;profit:Profit;officers:{id:string;name:string}[];branches:{id:string;name:string}[];filter:{branchId:string;collectorId:string}}){
  const query=new URLSearchParams();if(filter.branchId)query.set('cabang',filter.branchId);if(filter.collectorId)query.set('penagih',filter.collectorId);
  const csv=(kind:string)=>`/api/reports/csv?kind=${kind}${query.size?`&${query}`:''}`;
  const par=[{label:'Terlambat 1+ hari',data:report.par1},{label:'Terlambat 7+ hari',data:report.par7},{label:'Terlambat 30+ hari',data:report.par30}];
  return <Shell actor={actor} active="laporan">
    <PageHeader title="Laporan portofolio" subtitle={`Per ${shortDate(report.today)} · Kesehatan pinjaman, tagihan minggu ini, arus kas, dan kinerja penagih dari buku besar.`}/>
    <form className="filterBar" method="get">{actor.role==='owner'&&<label>Cabang<select name="cabang" defaultValue={filter.branchId}><option value="">Semua cabang</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      <label>Penagih<select name="penagih" defaultValue={filter.collectorId}><option value="">Semua penagih</option>{officers.map(o=><option key={o.id} value={o.id}>{displayName(o.name)}</option>)}</select></label><button className="secondary">Terapkan</button></form>
    <section className="metrics" aria-label="Indikator utama"><div><small>Pokok beredar</small><strong>{money(report.outstanding)}</strong><span>{report.activeCount} pinjaman aktif</span></div>
      {par.map(p=><div key={p.label} className={p.data.percent>=10?'metricAlert':undefined}><small>{p.label} (PAR)</small><strong>{pc(p.data.percent)}</strong><span>{p.data.count} pinjaman · {money(p.data.amount)}</span></div>)}
      <div><small>Tingkat tagih minggu ini</small><strong>{pc(report.week.rate)}</strong><span>{money(report.week.collected)} dari {money(report.week.due)}</span></div></section>
    <p className="reportNote">PAR = porsi pokok beredar dari pinjaman yang terlambat; di atas 10% ditandai merah. Tingkat tagih = bagian angsuran jatuh tempo {shortDate(report.week.start)} sampai {shortDate(report.week.end)} yang sudah dibayar. Total uang masuk minggu ini, termasuk pelunasan dan angsuran di muka: {money(report.week.received)}.</p>
    <ReportTable title="Target hari ini per penagih" csv={csv('target')} note="Target = angsuran jatuh tempo sampai hari ini yang belum dibayar pagi ini. Urut dari pencapaian tertinggi."
      head={['Peringkat','Penagih','Nasabah ditagih','Target','Tertagih','Pencapaian','Total diterima']}
      rows={report.targets.map((o,i)=>[i+1,`${displayName(o.name)}${actor.role==='owner'?` · ${o.branch}`:''}`,o.loans,money(o.target),money(o.collected),`${pc(o.rate)}`,money(o.received)])}/>
    <ReportTable title="Roll rate mingguan" csv={csv('roll-rate')} note="Dari pinjaman di satu kelompok seminggu sebelumnya, berapa persen yang pindah ke kelompok lebih buruk. Pulih = terlambat menjadi lancar. Naiknya roll rate memberi tanda lebih awal daripada PAR."
      head={['Minggu berakhir','Lancar → telat','Telat 1–7 → 8–30','Telat 8–30 → 31+','Pulih']}
      rows={report.roll.filter(r=>r.currentBase+r.lateBase>0).map(r=>[shortDate(r.weekEnd),`${pc(r.currentToLate)} dari ${r.currentBase}`,`${pc(r.d7ToD30)} dari ${r.d7Base}`,`${pc(r.d30ToD31)} dari ${r.d30Base}`,`${pc(r.cure)} dari ${r.lateBase}`])}/>
    {profit.total&&<section className="metrics compact" aria-label="Laba pinjaman"><div><small>Pendapatan</small><strong>{money(profit.total.income)}</strong><span>Bunga, denda, pemulihan</span></div>
      <div><small>Kerugian kredit</small><strong>{money(profit.total.losses)}</strong><span>Cadangan dan hapus buku</span></div>
      <div><small>Biaya dana dan operasional</small><strong>{money(profit.total.funding+profit.total.operating)}</strong><span>Biaya modal {profit.costBps/100}% per tahun</span></div>
      <div className={profit.total.net<0?'metricAlert':undefined}><small>Laba bersih</small><strong>{money(profit.total.net)}</strong><span>{pc(profit.total.margin)} dari pokok dicairkan</span></div></section>}
    {[{title:'Laba per tenor',rows:profit.byTenor},{title:'Laba per cabang',rows:profit.byBranch}].map(t=><ReportTable key={t.title} title={t.title} csv={csv('laba')}
      note={t.title==='Laba per tenor'?'Pendapatan dikurangi kerugian kredit, biaya dana (biaya modal tertimbang × lama pinjaman), dan biaya operasional yang dibagi menurut pokok × hari. Catat biaya di halaman Modal.':undefined}
      head={['Kelompok','Pinjaman','Pokok dicairkan','Pendapatan','Kerugian','Biaya dana','Biaya operasional','Laba bersih','Margin']}
      rows={t.rows.map(g=>[g.label,g.loans,money(g.principal),money(g.income),money(g.losses),money(g.funding),money(g.operating),money(g.net),`${pc(g.margin)}`])}/>)}
    <ReportTable title="Kinerja penagih" csv={csv('petugas')} head={['Penagih','Pinjaman aktif','Pokok beredar','Terlambat 7+','Jatuh tempo minggu ini','Tertagih','Tingkat tagih','Belum diverifikasi']}
      rows={report.officers.map(o=>[`${displayName(o.name)}${actor.role==='owner'?` · ${o.branch}`:''}`,o.active,money(o.outstanding),o.par7,money(o.due),money(o.collected),`${pc(o.rate)}`,o.pending])}/>
    <ReportTable title="Arus kas mingguan" csv={csv('arus-kas')} note="8 minggu terakhir dan perkiraan 4 minggu ke depan dari jadwal angsuran yang belum dibayar."
      head={['Minggu mulai','Dicairkan','Tertagih','Perkiraan masuk']} rows={report.cashflow.map(w=>[`${shortDate(w.week)}${w.future?' (perkiraan)':''}`,money(w.disbursed),w.future?'-':money(w.collected),w.expected?money(w.expected):'-'])}/>
    <ReportTable title="Vintage per minggu pencairan" csv={csv('vintage')} note="Berapa banyak dari setiap angkatan pinjaman yang sudah tertagih, terlambat, atau dihapusbukukan."
      head={['Minggu cair','Pinjaman','Dicairkan','Total kewajiban','Tertagih','Tertagih %','Terlambat','Lunas','Hapus buku']}
      rows={report.vintage.map(v=>[shortDate(v.week),v.loans,money(v.disbursed),money(v.due),money(v.collected),`${pc(v.repaidPercent)}`,v.late,v.paidOff,v.writtenOff])}/>
    <section className="register"><div className="sectionHead"><div><h2>Pinjaman terlambat</h2><p>Urut dari yang paling lama</p></div><a className="pillAction" href={csv('pinjaman')}>Unduh semua pinjaman (Excel)</a></div>
      {report.loans.filter(l=>l.dpd>0).length===0?<div className="empty">Tidak ada pinjaman terlambat.</div>:<div className="paymentList"><ul>{report.loans.filter(l=>l.dpd>0).sort((a,b)=>b.dpd-a.dpd).map(l=>
        <li key={l.id}><span><StatusChip tone="late">{l.dpd} hari</StatusChip> {displayName(l.customer)} · sisa {money(l.receivable)} · {displayName(l.collector)}</span><a href={`/pinjaman#case-${l.id}`}>Buka</a></li>)}</ul></div>}</section>
  </Shell>;
}

function ReportTable({title,head,rows,csv,note}:{title:string;head:string[];rows:(string|number)[][];csv:string;note?:string}){
  return <section className="register"><div className="sectionHead"><div><h2>{title}</h2>{note&&<p>{note}</p>}</div><a className="pillAction" href={csv}>Unduh Excel</a></div>
    {rows.length===0?<div className="empty">Belum ada data.</div>:<div className="schedule reportTable"><table><thead><tr>{head.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}</section>;
}
