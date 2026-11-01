'use client';
import {useState} from 'react';
import {PageHeader,Shell,StatusChip,displayName,money,shortDate,useAction,type StaffActor} from './Shell';
import {whatsappLink} from '@/lib/whatsapp';
import {Icon} from './icons';

type Item={id:string;customerId:string;promiseBroken:boolean;customerName:string;phone:string|null;collectorName:string|null;remaining:number;fee:number;nextDue:{dueAt:string;amount:number}|null;dpd:number;overdueAmount:number;
  lastVisit:{outcome:string;promiseDate:string|null;note:string|null;at:string}|null;bucket:'late'|'today'|'promise'|'week'|'later'};
const visitLabels:Record<string,string>={paid:'Bertemu, sudah bayar',promise:'Janji bayar',not_home:'Tidak di rumah',refused:'Menolak bayar',other:'Lainnya'};
const sections:{bucket:Item['bucket'];title:string;short:string;empty:string}[]=[
  {bucket:'late',short:'Terlambat',title:'Terlambat',empty:'Tidak ada yang terlambat.'},{bucket:'today',short:'Hari ini',title:'Jatuh tempo hari ini',empty:'Tidak ada yang jatuh tempo hari ini.'},
  {bucket:'promise',short:'Janji bayar',title:'Janji bayar jatuh hari ini',empty:'Tidak ada janji bayar yang jatuh hari ini.'},{bucket:'week',short:'7 hari',title:'7 hari ke depan',empty:'Tidak ada tagihan minggu ini.'}];

function reminder(item:Item){
  const name=displayName(item.customerName);
  if(item.dpd>0)return `Halo ${name}, angsuran pinjaman LN Anda tertunggak ${money(item.overdueAmount)} sejak ${shortDate(item.nextDue?.dueAt)}. Mohon segera dibayar atau hubungi petugas. Terima kasih.`;
  return `Halo ${name}, angsuran pinjaman LN sebesar ${money(item.nextDue?.amount)} jatuh tempo ${shortDate(item.nextDue?.dueAt)}. Mohon disiapkan. Terima kasih.`;
}

export default function CollectionList({actor,items,week,officers,collectorId,target}:{actor:StaffActor;items:Item[];week:{start:string;end:string;due:number;collected:number;received:number}|null;officers:{id:string;name:string}[];collectorId:string;target?:{target:number;collected:number;rate:number;loans:number}|null}){
  const action=useAction();
  const count=(bucket:Item['bucket'])=>items.filter(i=>i.bucket===bucket).length;
  const broken=items.filter(i=>i.promiseBroken).length;
  const tabs=[...sections.map(sec=>({key:sec.bucket as Item['bucket']|'all',label:sec.short,count:count(sec.bucket)})),{key:'all' as const,label:'Semua',count:items.filter(i=>i.bucket!=='later').length}];
  // Open on the first bucket that has work, so nobody lands on an empty list.
  const [tab,setTab]=useState<Item['bucket']|'all'>(()=>tabs.find(t=>t.key!=='all'&&t.count>0)?.key??'all');
  const visible=items.filter(i=>tab==='all'?i.bucket!=='later':i.bucket===tab);
  const urgent=count('late')+count('today')+count('promise');
  const date=new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',weekday:'long',day:'numeric',month:'long'}).format(new Date());
  const pct=target?Math.min(100,target.rate):week&&week.due?Math.min(100,Math.round(week.collected/week.due*100)):0;
  return <Shell actor={actor} active="tagihan">
    <PageHeader title="Tagihan" subtitle={date} actions={actor.role==='officer'?<a className="button secondary hideOnPhone" href="/setoran">Setor kas</a>:undefined}/>
    <section className="card dueSummary" aria-label="Ringkasan tagihan">
      <div className="dueStats">
        <div><strong>{urgent}</strong><small>hari ini</small></div>
        <div className={count('late')?'alert':undefined}><strong>{count('late')}</strong><small>terlambat</small></div>
        <div className={broken?'alert':undefined}><strong>{broken}</strong><small>janji lewat</small></div>
      </div>
      {(target||week)&&<div className="dueProgress"><div className="lbTop"><span>{target?'Target hari ini':'Tertagih minggu ini'}</span>
        <strong>{money(target?target.collected:week!.collected)} <span className="muted">/ {money(target?target.target:week!.due)}</span></strong></div>
        <div className="meterBar" role="progressbar" aria-label={target?'Kemajuan target hari ini':'Kemajuan tagihan minggu ini'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{width:`${pct}%`}}/></div></div>}
      {actor.role!=='officer'&&officers.length>0&&<label className="inlineSelect">Penagih
        <select value={collectorId} onChange={e=>{const url=new URL(window.location.href);if(e.target.value)url.searchParams.set('penagih',e.target.value);else url.searchParams.delete('penagih');window.location.assign(url.pathname+url.search);}}>
          <option value="">Semua penagih</option>{officers.map(o=><option key={o.id} value={o.id}>{displayName(o.name)}</option>)}</select></label>}
    </section>
    <div className="tabs segTabs" role="tablist" aria-label="Kelompok tagihan">{tabs.map(t=><button key={t.key} role="tab" aria-selected={tab===t.key} className={tab===t.key?'tab active':'tab'} onClick={()=>setTab(t.key)}>
      {t.label}<span className="tabCount">{t.count}</span></button>)}</div>
    {visible.length===0?<div className="calmEmpty"><strong>{tab==='all'?'Tidak ada tagihan dalam 7 hari':sections.find(sec=>sec.bucket===tab)?.empty}</strong>
        {tabs.some(t=>t.key!==tab&&t.key!=='all'&&t.count>0)&&<button className="linkButton" onClick={()=>setTab(tabs.find(t=>t.key!=='all'&&t.count>0)!.key)}>Lihat {tabs.find(t=>t.key!=='all'&&t.count>0)!.label.toLowerCase()}</button>}</div>
      :<div className="caseList">{visible.map(item=><DueCard key={item.id} item={item} showCollector={actor.role!=='officer'} pending={action.pending} run={action.run}/>)}</div>}
    {action.feedback}
  </Shell>;
}

function DueCard({item,showCollector,pending,run}:{item:Item;showCollector:boolean;pending:boolean;run:ReturnType<typeof useAction>['run']}){
  const [visit,setVisit]=useState(false);
  const [outcome,setOutcome]=useState('not_home');
  const wa=whatsappLink(item.phone,reminder(item));
  const chip=item.promiseBroken?<StatusChip tone="late">Janji bayar {shortDate(item.lastVisit?.promiseDate)} terlewat</StatusChip>:item.dpd>0?<StatusChip tone="late">Terlambat {item.dpd} hari</StatusChip>:item.bucket==='today'?<StatusChip tone="due">Jatuh tempo hari ini</StatusChip>:
    item.bucket==='promise'?<StatusChip tone="due">Janji bayar hari ini</StatusChip>:<StatusChip tone="ok">{shortDate(item.nextDue?.dueAt)}</StatusChip>;
  return <article className="case dueCard"><div className="caseTop"><div>{chip}{item.promiseBroken&&item.dpd>0&&<StatusChip tone="late">Terlambat {item.dpd} hari</StatusChip>}<h3><a className="nameLink" href={`/nasabah/${item.customerId}`}>{displayName(item.customerName)}</a></h3>
      <p>{item.dpd>0?`Tertunggak ${money(item.overdueAmount)}`:`Angsuran ${money(item.nextDue?.amount)}`} · sisa {money(item.remaining)}{showCollector&&item.collectorName?` · ${displayName(item.collectorName)}`:''}</p>
      {item.lastVisit&&<p className="lastVisit">Kunjungan terakhir {shortDate(item.lastVisit.at)}: {visitLabels[item.lastVisit.outcome]}{item.lastVisit.promiseDate?` ${shortDate(item.lastVisit.promiseDate)}`:''}{item.lastVisit.note?` · ${item.lastVisit.note}`:''}</p>}</div></div>
    <div className="dueActions">
      <a className="pillAction primary payAction" href={`/pinjaman#case-${item.id}`}>Catat bayar</a>
      {item.phone?<a className="pillAction iconAction" href={`tel:${item.phone.replace(/[^\d+]/g,'')}`} aria-label={`Telepon ${displayName(item.customerName)}`} title="Telepon"><Icon name="phone"/></a>:<span className="pillAction iconAction disabled" aria-hidden="true"><Icon name="phone"/></span>}
      {wa?<a className="pillAction iconAction" href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${displayName(item.customerName)}`} title="WhatsApp"><Icon name="chat"/></a>:<span className="pillAction iconAction disabled" aria-hidden="true"><Icon name="chat"/></span>}
      <button className="pillAction iconAction" aria-expanded={visit} onClick={()=>setVisit(!visit)} aria-label={`Catat kunjungan ${displayName(item.customerName)}`} title="Catat kunjungan"><Icon name="location"/></button></div>
    {visit&&<form className="visitForm" method="post" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);run('/api/ops',{type:'log_visit',applicationId:item.id,outcome,promiseDate:outcome==='promise'?String(f.get('promiseDate')):null,note:String(f.get('note')??'')},{success:'Kunjungan tercatat.',offline:`Kunjungan ${displayName(item.customerName)}`});}}>
      <fieldset className="tenorChoice"><legend>Hasil kunjungan</legend>{Object.entries(visitLabels).map(([key,label])=><label key={key}><input type="radio" name="outcome" value={key} checked={outcome===key} onChange={()=>setOutcome(key)}/><span>{label}</span></label>)}</fieldset>
      {outcome==='promise'&&<label>Tanggal janji bayar<input name="promiseDate" type="date" required/></label>}
      <label>Catatan (opsional)<input name="note" maxLength={500}/></label><button disabled={pending}>Simpan kunjungan</button></form>}
  </article>;
}
