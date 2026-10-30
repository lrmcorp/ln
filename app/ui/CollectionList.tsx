'use client';
import {useState} from 'react';
import {PageHeader,Shell,StatusChip,displayName,money,shortDate,useAction,type StaffActor} from './Shell';
import {whatsappLink} from '@/lib/whatsapp';

type Item={id:string;customerName:string;phone:string|null;collectorName:string|null;remaining:number;fee:number;nextDue:{dueAt:string;amount:number}|null;dpd:number;overdueAmount:number;
  lastVisit:{outcome:string;promiseDate:string|null;note:string|null;at:string}|null;bucket:'late'|'today'|'promise'|'week'|'later'};
const visitLabels:Record<string,string>={paid:'Bertemu, sudah bayar',promise:'Janji bayar',not_home:'Tidak di rumah',refused:'Menolak bayar',other:'Lainnya'};
const sections:{bucket:Item['bucket'];title:string;empty:string}[]=[
  {bucket:'late',title:'Terlambat',empty:'Tidak ada yang terlambat.'},{bucket:'today',title:'Jatuh tempo hari ini',empty:'Tidak ada yang jatuh tempo hari ini.'},
  {bucket:'promise',title:'Janji bayar jatuh hari ini',empty:'Tidak ada janji bayar yang jatuh hari ini.'},{bucket:'week',title:'7 hari ke depan',empty:'Tidak ada tagihan minggu ini.'}];

function reminder(item:Item){
  const name=displayName(item.customerName);
  if(item.dpd>0)return `Halo ${name}, angsuran pinjaman LN Anda tertunggak ${money(item.overdueAmount)} sejak ${shortDate(item.nextDue?.dueAt)}. Mohon segera dibayar atau hubungi petugas. Terima kasih.`;
  return `Halo ${name}, angsuran pinjaman LN sebesar ${money(item.nextDue?.amount)} jatuh tempo ${shortDate(item.nextDue?.dueAt)}. Mohon disiapkan. Terima kasih.`;
}

export default function CollectionList({actor,items,week,officers,collectorId,target}:{actor:StaffActor;items:Item[];week:{start:string;end:string;due:number;collected:number;received:number}|null;officers:{id:string;name:string}[];collectorId:string;target?:{target:number;collected:number;rate:number;loans:number}|null}){
  const action=useAction();
  const counts={late:items.filter(i=>i.bucket==='late').length,today:items.filter(i=>i.bucket==='today').length,promise:items.filter(i=>i.bucket==='promise').length};
  const focus=counts.late+counts.today+counts.promise;
  return <Shell actor={actor} active="tagihan">
    <PageHeader title="Tagihan hari ini" subtitle={<>{new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'full'}).format(new Date())} · {actor.role==='officer'?'Kunjungi yang terlambat lebih dulu, lalu yang jatuh tempo hari ini.':'Saring per penagih.'}</>}
      actions={actor.role==='officer'?<a className="button secondary" href="/setoran">Setor kas</a>:undefined}/>
    <section className="focusPanel" aria-label="Fokus saat ini"><div><small>Perlu didatangi hari ini</small><strong>{focus?`${focus} nasabah · ${counts.late} terlambat`:'Semua tagihan hari ini aman'}</strong></div>
      {week&&<div className="weekTarget"><small>Angsuran minggu ini tertagih</small><strong>{money(week.collected)} dari {money(week.due)}</strong></div>}</section>
    {target&&<section className="card targetCard" aria-labelledby="target-title"><div className="cardHead"><h2 id="target-title">Target hari ini</h2><span className="muted">{target.loans} nasabah ditarget</span></div>
      <div className="meterTop"><strong>{money(target.collected)}</strong><span className="muted">dari {money(target.target)} · {target.rate.toLocaleString('id-ID')}%</span></div>
      <div className="meterBar" role="progressbar" aria-label="Kemajuan target hari ini" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,target.rate)}><span style={{width:`${Math.min(100,target.rate)}%`}}/></div>
      <small className="muted">Angsuran yang jatuh tempo sampai hari ini dan belum dibayar pagi ini. Bayaran di atas target tidak dihitung.</small></section>}
    {actor.role!=='officer'&&<form className="filterBar" method="get"><label>Penagih<select name="penagih" defaultValue={collectorId}><option value="">Semua penagih</option>{officers.map(o=><option key={o.id} value={o.id}>{displayName(o.name)}</option>)}</select></label><button className="secondary">Terapkan</button></form>}
    {sections.map(section=>{const list=items.filter(item=>item.bucket===section.bucket);
      return <section key={section.bucket} className="register" aria-labelledby={`tagihan-${section.bucket}`}><div className="sectionHead"><div><h2 id={`tagihan-${section.bucket}`}>{section.title}</h2><p>{list.length} nasabah</p></div></div>
        {list.length===0?<div className="empty">{section.empty}</div>:<div className="caseList">{list.map(item=><DueCard key={item.id} item={item} showCollector={actor.role!=='officer'} pending={action.pending} run={action.run}/>)}</div>}</section>;})}
    {action.feedback}
  </Shell>;
}

function DueCard({item,showCollector,pending,run}:{item:Item;showCollector:boolean;pending:boolean;run:ReturnType<typeof useAction>['run']}){
  const [visit,setVisit]=useState(false);
  const [outcome,setOutcome]=useState('not_home');
  const wa=whatsappLink(item.phone,reminder(item));
  const chip=item.dpd>0?<StatusChip tone="late">Terlambat {item.dpd} hari</StatusChip>:item.bucket==='today'?<StatusChip tone="due">Jatuh tempo hari ini</StatusChip>:
    item.bucket==='promise'?<StatusChip tone="due">Janji bayar hari ini</StatusChip>:<StatusChip tone="ok">{shortDate(item.nextDue?.dueAt)}</StatusChip>;
  return <article className="case dueCard"><div className="caseTop"><div>{chip}<h3>{displayName(item.customerName)}</h3>
      <p>{item.dpd>0?`Tertunggak ${money(item.overdueAmount)}`:`Angsuran ${money(item.nextDue?.amount)}`} · sisa {money(item.remaining)}{showCollector&&item.collectorName?` · ${displayName(item.collectorName)}`:''}</p>
      {item.lastVisit&&<p className="lastVisit">Kunjungan terakhir {shortDate(item.lastVisit.at)}: {visitLabels[item.lastVisit.outcome]}{item.lastVisit.promiseDate?` ${shortDate(item.lastVisit.promiseDate)}`:''}{item.lastVisit.note?` · ${item.lastVisit.note}`:''}</p>}</div></div>
    <div className="dueActions">{item.phone&&<a className="pillAction" href={`tel:${item.phone.replace(/[^\d+]/g,'')}`}>Telepon</a>}{wa&&<a className="pillAction" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
      <a className="pillAction primary" href={`/pinjaman#case-${item.id}`}>Catat bayar</a><button className="pillAction" aria-expanded={visit} onClick={()=>setVisit(!visit)}>Catat kunjungan</button></div>
    {visit&&<form className="visitForm" method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);run('/api/ops',{type:'log_visit',applicationId:item.id,outcome,promiseDate:outcome==='promise'?String(f.get('promiseDate')):null,note:String(f.get('note')??'')},{success:'Kunjungan tercatat.'});}}>
      <fieldset className="tenorChoice"><legend>Hasil kunjungan</legend>{Object.entries(visitLabels).map(([key,label])=><label key={key}><input type="radio" name="outcome" value={key} checked={outcome===key} onChange={()=>setOutcome(key)}/><span>{label}</span></label>)}</fieldset>
      {outcome==='promise'&&<label>Tanggal janji bayar<input name="promiseDate" type="date" required/></label>}
      <label>Catatan (opsional)<input name="note" maxLength={500}/></label><button disabled={pending}>Simpan kunjungan</button></form>}
  </article>;
}
