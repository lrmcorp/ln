'use client';
import {money,shortDate} from './Shell';
import type {capitalReport} from '@/lib/admin';
import type {portfolioReport} from '@/lib/reports';
import type {profitReport} from '@/lib/profit';

type Props={month:string;today:string;capital:Awaited<ReturnType<typeof capitalReport>>;portfolio:Awaited<ReturnType<typeof portfolioReport>>;profit:Awaited<ReturnType<typeof profitReport>>};
const pc=(v:number)=>`${v.toLocaleString('id-ID')}%`;
const monthLabel=(month:string)=>new Date(`${month}-15T12:00:00Z`).toLocaleDateString('id-ID',{month:'long',year:'numeric',timeZone:'UTC'});

// One-page monthly report for investors; the browser's print dialog saves it as PDF.
export default function InvestorReport({month,today,capital,portfolio,profit}:Props){
  const m=capital.monthly.find(row=>row.month===month)??{month,disbursed:0,collected:0,income:0,losses:0,opex:0,net:0};
  const months=capital.monthly.map(row=>row.month);
  const yieldPct=capital.deployed?Math.round(m.net*12/capital.deployed*1000)/10:0;
  return <main className="investorReport">
    <div className="reportBar noPrint"><a href="/modal">Kembali ke Modal</a>
      <form method="get"><label>Bulan<select name="bulan" defaultValue={month} onChange={e=>e.currentTarget.form?.submit()}>{(months.includes(month)?months:[month,...months]).map(v=><option key={v} value={v}>{monthLabel(v)}</option>)}</select></label></form>
      <button onClick={()=>window.print()}>Simpan sebagai PDF</button></div>
    <article className="sheet">
      <header className="sheetHead"><div><p className="wordmark">LN</p><h1>Laporan investor {monthLabel(month)}</h1><p>Dibuat {shortDate(today)}. Angka dari buku besar LN. Data demo sintetis.</p></div></header>
      <section><h2>Ringkasan bulan ini</h2><dl className="figures">
        <div><dt>Dicairkan</dt><dd>{money(m.disbursed)}</dd></div><div><dt>Tertagih</dt><dd>{money(m.collected)}</dd></div>
        <div><dt>Pendapatan</dt><dd>{money(m.income)}</dd></div><div><dt>Kerugian kredit</dt><dd>{money(m.losses)}</dd></div>
        <div><dt>Biaya operasional</dt><dd>{money(m.opex)}</dd></div><div><dt>Hasil bersih</dt><dd>{money(m.net)}</dd></div>
        <div><dt>Hasil bersih disetahunkan</dt><dd>{yieldPct.toLocaleString('id-ID')}%</dd></div><div><dt>Biaya modal tertimbang</dt><dd>{(profit.costBps/100).toLocaleString('id-ID')}% per tahun</dd></div>
      </dl></section>
      <section><h2>Posisi modal hari ini</h2><dl className="figures">
        <div><dt>Modal tercatat</dt><dd>{money(capital.capital)}</dd></div><div><dt>Dipinjamkan</dt><dd>{money(capital.deployed)} ({pc(capital.utilisation)})</dd></div>
        <div><dt>Kas</dt><dd>{money(capital.idleCash)}</dd></div><div><dt>Tunai di petugas</dt><dd>{money(capital.inTransit)}</dd></div>
      </dl>
      {capital.sources.length>0&&<table><thead><tr><th>Sumber dana</th><th>Jenis</th><th>Modal bersih</th><th>Sudah dibagi</th><th>Biaya per tahun</th></tr></thead>
        <tbody>{capital.sources.map(s=><tr key={s.source+s.type}><td>{s.source}</td><td>{s.type==='owner'?'Pemilik':'Investor'}</td><td>{money(s.net)}</td><td>{money(s.distributed)}</td><td>{pc(s.costBps/100)}</td></tr>)}</tbody></table>}</section>
      <section><h2>Kualitas portofolio hari ini</h2><dl className="figures">
        <div><dt>Pinjaman aktif</dt><dd>{portfolio.activeCount}</dd></div><div><dt>Pokok beredar</dt><dd>{money(portfolio.outstanding)}</dd></div>
        <div><dt>Terlambat 1+ hari</dt><dd>{pc(portfolio.par1.percent)}</dd></div><div><dt>Terlambat 7+ hari</dt><dd>{pc(portfolio.par7.percent)}</dd></div>
        <div><dt>Terlambat 30+ hari</dt><dd>{pc(portfolio.par30.percent)}</dd></div><div><dt>Tingkat tagih minggu ini</dt><dd>{pc(portfolio.week.rate)}</dd></div>
      </dl>
      {portfolio.roll.some(r=>r.currentBase+r.lateBase>0)?<table><thead><tr><th>Minggu berakhir</th><th>Lancar → telat</th><th>1–7 → 8–30</th><th>8–30 → 31+</th><th>Pulih</th></tr></thead>
        <tbody>{portfolio.roll.filter(r=>r.currentBase+r.lateBase>0).slice(-4).map(r=><tr key={r.weekEnd}><td>{shortDate(r.weekEnd)}</td><td>{pc(r.currentToLate)}</td><td>{pc(r.d7ToD30)}</td><td>{pc(r.d30ToD31)}</td><td>{pc(r.cure)}</td></tr>)}</tbody></table>:<p className="muted">Roll rate tersedia setelah pinjaman berjalan lebih dari seminggu.</p>}</section>
      <section><h2>Laba per tenor, sejak awal</h2>
        <table><thead><tr><th>Tenor</th><th>Pinjaman</th><th>Pokok dicairkan</th><th>Pendapatan</th><th>Kerugian</th><th>Biaya</th><th>Laba bersih</th><th>Margin</th></tr></thead>
          <tbody>{profit.byTenor.map(g=><tr key={g.key}><td>{g.label}</td><td>{g.loans}</td><td>{money(g.principal)}</td><td>{money(g.income)}</td><td>{money(g.losses)}</td><td>{money(g.funding+g.operating)}</td><td>{money(g.net)}</td><td>{pc(g.margin)}</td></tr>)}</tbody></table></section>
      <section><h2>Tren 6 bulan</h2>
        <table><thead><tr><th>Bulan</th><th>Dicairkan</th><th>Tertagih</th><th>Pendapatan</th><th>Kerugian</th><th>Biaya operasional</th><th>Hasil bersih</th></tr></thead>
          <tbody>{capital.monthly.filter(row=>row.month<=month).slice(0,6).map(row=><tr key={row.month}><td>{monthLabel(row.month)}</td><td>{money(row.disbursed)}</td><td>{money(row.collected)}</td><td>{money(row.income)}</td><td>{money(row.losses)}</td><td>{money(row.opex)}</td><td>{money(row.net)}</td></tr>)}</tbody></table></section>
      <footer className="sheetFoot">Posisi modal dan kualitas portofolio dihitung pada tanggal laporan dibuat, bukan akhir bulan. Kerugian kredit termasuk pembentukan cadangan. Laporan ini dibuat dari data demo dan bukan laporan keuangan teraudit.</footer>
    </article>
  </main>;
}
