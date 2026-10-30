'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {PageHeader,Shell,StatusChip,displayName,money,shortDate,type StaffActor} from './Shell';
import type {HomeDashboard} from '@/lib/dashboard';

const compact=(value:number)=>value>=1e9?`${(value/1e9).toLocaleString('id-ID',{maximumFractionDigits:1})} M`:value>=1e6?`${(value/1e6).toLocaleString('id-ID',{maximumFractionDigits:1})} jt`:value>=1e3?`${Math.round(value/1e3)} rb`:String(value);
const monthName=(iso:string)=>new Date(`${iso}T12:00:00Z`).toLocaleDateString('id-ID',{month:'long',timeZone:'UTC'});
const time=(iso:string)=>new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));

export default function Dashboard({actor,data,branch}:{actor:StaffActor;data:HomeDashboard;branch:string}){
  const router=useRouter();
  // Refresh server data every minute while the tab is visible.
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')router.refresh();},60000);return()=>clearInterval(timer);},[router]);
  const first=displayName(actor.name).split(' ')[0];
  const date=new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'full'}).format(new Date(`${data.today}T12:00:00+07:00`));
  const verifyCount=data.verify.payments+data.verify.deposits;
  const query=branch?`?cabang=${branch}`:'';
  const primary=verifyCount>0?{href:'/verifikasi',label:`Verifikasi ${verifyCount} bukti`}:{href:'/tagihan',label:'Lihat tagihan'};
  const change=data.cash.change;
  return <Shell actor={actor} active="beranda">
    <PageHeader title={`Halo, ${first}`} subtitle={<>{date} · Data diperbarui otomatis, terakhir {time(data.generatedAt)}{branch?' · satu cabang':''}</>}
      actions={<><a className="button secondary" href={`/api/reports/csv?kind=pinjaman${branch?`&cabang=${branch}`:''}`}>Unduh laporan</a><a className="button" href={primary.href}>{primary.label}</a></>}/>
    <div className="dashGrid">
      <section className="card cashCard" aria-labelledby="cash-title">
        <div className="cardHead"><h2 id="cash-title">Uang masuk</h2><span className="muted">Pembayaran nasabah, termasuk yang menunggu verifikasi</span></div>
        <div className="kpiRow">
          <div className="kpi lead"><small>Bulan ini</small><strong>{money(data.cash.month)}</strong>
            {change!==null&&<span className={change>=0?'trend up':'trend down'}>{change>=0?'Naik':'Turun'} {Math.abs(change).toLocaleString('id-ID')}% dari periode sama bulan lalu</span>}</div>
          <div className="kpi"><small>Hari ini</small><strong>{money(data.cash.today)}</strong></div>
          <div className="kpi"><small>Pendapatan diakui</small><strong>{money(data.cash.income)}</strong><span className="muted">Bunga, denda, pemulihan bulan ini</span></div>
          <div className="kpi"><small>Pokok beredar</small><strong>{money(data.outstanding)}</strong><span className="muted">{data.activeCount} pinjaman aktif</span></div>
        </div>
        <CashChart data={data}/>
      </section>
      <div className="sideStack">
        <section className="card" aria-labelledby="risk-title">
          <div className="cardHead"><h2 id="risk-title">Risiko portofolio</h2></div>
          <RiskMeter percent={data.par7.percent}/>
          <dl className="rows">
            <div><dt>Terlambat 1+ hari</dt><dd>{data.par1.percent.toLocaleString('id-ID')}% · {data.par1.count}</dd></div>
            <div><dt>Terlambat 7+ hari</dt><dd>{data.par7.percent.toLocaleString('id-ID')}% · {data.par7.count}</dd></div>
            <div><dt>Terlambat 30+ hari</dt><dd>{data.par30.percent.toLocaleString('id-ID')}% · {data.par30.count}</dd></div>
            <div><dt>Tingkat tagih minggu ini</dt><dd>{data.collectionRate.toLocaleString('id-ID')}%</dd></div>
          </dl>
        </section>
        <section className="card" aria-labelledby="count-title">
          <div className="cardHead"><h2 id="count-title">Angka pinjaman</h2></div>
          <dl className="rows">
            <div><dt>Aktif</dt><dd>{data.counts.active}</dd></div>
            <div><dt>Terlambat</dt><dd className={data.counts.late?'alertText':undefined}>{data.counts.late}</dd></div>
            <div><dt>Dalam proses</dt><dd>{data.counts.inProcess}</dd></div>
            <div><dt>Lunas</dt><dd>{data.counts.finished}</dd></div>
            {data.counts.writtenOff>0&&<div><dt>Dihapusbukukan</dt><dd>{data.counts.writtenOff}</dd></div>}
          </dl>
          <a className="cardLink" href={`/laporan${query}`}>Laporan lengkap</a>
        </section>
      </div>
    </div>
    <div className="cardGrid">
      <section className="card" aria-labelledby="todo-title">
        <div className="cardHead"><h2 id="todo-title">Perlu tindakan</h2><span className="countPill">{data.pipeline.length+(verifyCount?1:0)}</span></div>
        {data.pipeline.length===0&&verifyCount===0?<p className="emptyLine">Tidak ada yang menunggu Anda.</p>:<ul className="list">
          {verifyCount>0&&<li><a href="/verifikasi"><span><strong>Verifikasi bukti</strong><small>{data.verify.payments} pembayaran · {data.verify.deposits} setoran kas</small></span><span className="go">Buka</span></a></li>}
          {data.pipeline.slice(0,5).map(item=><li key={item.id}><a href={`/pinjaman#case-${item.id}`}><span><strong>{displayName(item.customer)}</strong><small>{item.step} · {money(item.principal)}</small></span><span className="go">Buka</span></a></li>)}
        </ul>}
        {data.pipeline.length>5&&<a className="cardLink" href="/pinjaman">Semua {data.pipeline.length} pengajuan</a>}
      </section>
      <section className="card" aria-labelledby="due-title">
        <div className="cardHead"><h2 id="due-title">Jatuh tempo 7 hari</h2><span className="muted">{money(data.upcomingTotal)}</span></div>
        {data.upcoming.length===0?<p className="emptyLine">Tidak ada angsuran jatuh tempo minggu ini.</p>:<ul className="list">
          {data.upcoming.map(item=><li key={`${item.id}-${item.dueAt}`}><a href={`/pinjaman#case-${item.id}`}><span><strong>{displayName(item.customer)}</strong><small>{item.dueAt===data.today?'Hari ini':shortDate(item.dueAt)} · {displayName(item.collector)}</small></span><span className="amount">{money(item.amount)}</span></a></li>)}
        </ul>}
        {data.upcomingCount>data.upcoming.length&&<a className="cardLink" href="/tagihan">Semua {data.upcomingCount} angsuran</a>}
      </section>
      <section className="card" aria-labelledby="late-title">
        <div className="cardHead"><h2 id="late-title">Terlambat paling lama</h2>{data.counts.late>0&&<span className="countPill warn">{data.counts.late}</span>}</div>
        {data.late.length===0?<p className="emptyLine">Semua pinjaman aktif lancar.</p>:<ul className="list">
          {data.late.map(item=><li key={item.id}><a href={`/pinjaman#case-${item.id}`}><span><strong>{displayName(item.customer)}</strong><small><StatusChip tone="late">{item.dpd} hari</StatusChip>{displayName(item.collector)}</small></span><span className="amount">{money(item.overdue)}</span></a></li>)}
        </ul>}
        {data.counts.late>0&&<a className="cardLink" href="/tagihan">Buka tagihan</a>}
      </section>
    </div>
  </Shell>;
}

// PAR7 against simple thresholds: under 5% healthy, 5 to 10% watch, above 10% high.
function RiskMeter({percent}:{percent:number}){
  const level=percent<5?{label:'Aman',tone:'ok'}:percent<10?{label:'Waspada',tone:'due'}:{label:'Tinggi',tone:'late'};
  return <div className="meter"><div className="meterTop"><strong>{percent.toLocaleString('id-ID')}%</strong><StatusChip tone={level.tone as 'ok'|'due'|'late'}>{level.label}</StatusChip></div>
    <div className={`meterBar ${level.tone}`} role="meter" aria-label="Porsi pokok terlambat 7 hari atau lebih" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{width:`${Math.min(100,percent*5)}%`}}/></div>
    <small className="muted">Porsi pokok beredar yang terlambat 7 hari atau lebih. Skala bar sampai 20%.</small></div>;
}

function CashChart({data}:{data:HomeDashboard}){
  const [table,setTable]=useState(false);
  const [hover,setHover]=useState<number|null>(null);
  const box=useRef<SVGSVGElement>(null);
  const {thisMonth,lastMonth}=data.cash;
  const days=Math.max(lastMonth.length,thisMonth.length);
  const max=Math.max(1,...thisMonth,...lastMonth);
  const W=640,H=220,L=8,R=8,T=12,B=26;
  const x=(i:number)=>L+(days<=1?0:i/(days-1))*(W-L-R);
  const y=(v:number)=>T+(1-v/max)*(H-T-B);
  const path=(values:number[])=>values.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const thisName=monthName(data.cash.monthStart),lastName=monthName(data.cash.lastMonthStart);
  const ticks=[0,.5,1].map(f=>max*f);
  function move(event:React.PointerEvent<SVGSVGElement>){
    const rect=box.current?.getBoundingClientRect();if(!rect)return;
    const ratio=(event.clientX-rect.left)/rect.width;
    setHover(Math.max(0,Math.min(days-1,Math.round(((ratio*W)-L)/(W-L-R)*(days-1)))));
  }
  const tip=hover===null?null:{day:hover+1,now:thisMonth[hover],last:lastMonth[hover],left:x(hover)/W*100};
  return <div className="chartBlock">
    <div className="chartHead"><div className="legend"><span><i className="swatch s1"/>{thisName}</span><span><i className="swatch s2 dashed"/>{lastName}</span></div>
      <button className="linkButton" onClick={()=>setTable(!table)} aria-expanded={table}>{table?'Lihat grafik':'Lihat tabel'}</button></div>
    {table?<div className="tableWrap"><table className="dataTable"><caption className="srOnly">Uang masuk kumulatif per tanggal</caption><thead><tr><th>Tanggal</th><th>{thisName}</th><th>{lastName}</th></tr></thead>
      <tbody>{Array.from({length:days},(_,i)=><tr key={i}><td>{i+1}</td><td>{thisMonth[i]!==undefined?money(thisMonth[i]):'-'}</td><td>{lastMonth[i]!==undefined?money(lastMonth[i]):'-'}</td></tr>)}</tbody></table></div>:
    <div className="chart">
      <div className="axisY" aria-hidden="true">{ticks.map(v=><span key={v} style={{top:y(v)}}>{compact(v)}</span>)}</div>
      <div className="plot">
        <svg ref={box} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Uang masuk kumulatif ${thisName} ${money(thisMonth.at(-1)??0)}, ${lastName} ${money(lastMonth.at(-1)??0)}`}
          onPointerMove={move} onPointerDown={move} onPointerLeave={()=>setHover(null)}>
          {ticks.map(v=><line key={v} className="grid" x1={L} x2={W-R} y1={y(v)} y2={y(v)} vectorEffect="non-scaling-stroke"/>)}
          <path className="line s2" d={path(lastMonth)} vectorEffect="non-scaling-stroke"/>
          <path className="line s1" d={path(thisMonth)} vectorEffect="non-scaling-stroke"/>
          {tip&&<line className="cross" x1={x(hover!)} x2={x(hover!)} y1={T} y2={H-B} vectorEffect="non-scaling-stroke"/>}
        </svg>
        {tip&&tip.now!==undefined&&<span className="dot s1" style={{left:`${tip.left}%`,top:y(tip.now)}}/>}
        {tip&&tip.last!==undefined&&<span className="dot s2" style={{left:`${tip.left}%`,top:y(tip.last)}}/>}
        <div className="axisX" aria-hidden="true"><span>1</span><span>{Math.ceil(days/2)}</span><span>{days}</span></div>
        {tip&&<div className="tooltip" style={{left:`clamp(80px, ${tip.left}%, calc(100% - 80px))`}}><strong>Tanggal {tip.day}</strong>
          <span><i className="swatch s1"/>{tip.now!==undefined?money(tip.now):'Belum berjalan'}</span><span><i className="swatch s2 dashed"/>{tip.last!==undefined?money(tip.last):'-'}</span></div>}
      </div>
    </div>}
  </div>;
}
