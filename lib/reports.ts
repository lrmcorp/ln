import type {Actor} from './auth';
import {requireRole} from './auth';
import {pool} from './db';
import {addDays,daysBetween,runPortfolioAccruals,todayIso} from './accounting';
import {weekBounds} from './collections';

export type ReportFilter={branchId?:string|null;collectorId?:string|null};

export function scope(actor:Actor,filter:ReportFilter){
  requireRole(actor,['owner','manager','officer']);
  // Officers only ever see the loans they collect.
  if(actor.role==='officer')filter={collectorId:actor.id};
  const params:unknown[]=[];
  const parts:string[]=[];
  const branch=actor.role==='manager'?actor.branch_id:filter.branchId||null;
  if(branch){params.push(branch);parts.push(`a.branch_id=$${params.length}`);}
  if(filter.collectorId){params.push(filter.collectorId);parts.push(`COALESCE(a.collector_id,a.officer_id)=$${params.length}`);}
  return {params,where:parts.length?`AND ${parts.join(' AND ')}`:''};
}

export type LoanRow={id:string;status:string;branch_id:string;branch_name:string;collector_id:string;collector_name:string;customer_name:string;
  principal:number;interest:number;disbursed_at:string|null;paid:number;collected_total:number;recovery:number;
  outstanding_principal:number;receivable:number;rows:{dueAt:string;amount:number}[];paidLog:{at:string;amount:number}[];term_weeks:number|null};

export async function loans(actor:Actor,filter:ReportFilter):Promise<LoanRow[]>{
  const {params,where}=scope(actor,filter);
  const rows=(await pool.query(`SELECT a.id,a.status,a.branch_id,b.name AS branch_name,COALESCE(a.collector_id,a.officer_id) AS collector_id,u.name AS collector_name,c.name AS customer_name,
      COALESCE(a.approved_principal,0)::bigint AS principal,COALESCE(a.interest_amount,0)::bigint AS interest,to_char(a.disbursed_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS disbursed_at,
      COALESCE((SELECT SUM(principal+interest) FROM payments p WHERE p.application_id=a.id AND p.status<>'rejected'),0)::bigint AS paid,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.application_id=a.id AND p.status<>'rejected'),0)::bigint AS collected_total,
      COALESCE((SELECT SUM(recovery) FROM payments p WHERE p.application_id=a.id AND p.status<>'rejected'),0)::bigint AS recovery,
      COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.application_id=a.id AND l.account='principal_receivable'),0)::bigint AS outstanding_principal,
      COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.application_id=a.id AND l.account IN ('principal_receivable','interest_receivable','fee_receivable')),0)::bigint AS receivable,
      COALESCE((SELECT json_agg(json_build_object('dueAt',to_char(i.due_at,'YYYY-MM-DD'),'amount',i.principal+i.interest) ORDER BY i.sequence) FROM installments i WHERE i.application_id=a.id),'[]') AS rows,
      COALESCE((SELECT json_agg(json_build_object('at',to_char(p.created_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD'),'amount',p.principal+p.interest) ORDER BY p.created_at) FROM payments p WHERE p.application_id=a.id AND p.status<>'rejected'),'[]') AS "paidLog",
      a.term_weeks
    FROM applications a JOIN customers c ON c.id=a.customer_id JOIN branches b ON b.id=a.branch_id LEFT JOIN users u ON u.id=COALESCE(a.collector_id,a.officer_id)
    WHERE a.status IN ('active','paid_off','closed','written_off') ${where}`,params)).rows;
  return rows.map(row=>({...row,principal:Number(row.principal),interest:Number(row.interest),paid:Number(row.paid),collected_total:Number(row.collected_total),
    recovery:Number(row.recovery),outstanding_principal:Number(row.outstanding_principal),receivable:Number(row.receivable)}));
}

// Remaining amount per installment row after applying what was paid toward the schedule.
export function openRows(loan:LoanRow){
  let cumulative=0;
  return loan.rows.map(row=>{const before=cumulative;cumulative+=Number(row.amount);return {dueAt:row.dueAt,open:Math.max(0,cumulative-Math.max(before,loan.paid))};});
}
export function dpdOf(loan:LoanRow,today:string){
  if(loan.status!=='active')return 0;
  const first=openRows(loan).find(row=>row.open>0);
  return first&&first.dueAt<today?daysBetween(first.dueAt,today):0;
}

// Days past due as of a past date, using only payments recorded by then; null when the loan was not yet disbursed or already fully paid.
export function dpdAsOf(loan:LoanRow,date:string){
  if(!loan.disbursed_at||loan.disbursed_at>date)return null;
  const paid=loan.paidLog.filter(p=>p.at<=date).reduce((s,p)=>s+Number(p.amount),0);
  const total=loan.rows.reduce((s,row)=>s+Number(row.amount),0);
  if(paid>=total)return null;
  let cumulative=0;
  const first=loan.rows.find(row=>(cumulative+=Number(row.amount))>paid);
  return first&&first.dueAt<date?daysBetween(first.dueAt,date):0;
}
const bucketOf=(dpd:number)=>dpd===0?0:dpd<=7?1:dpd<=30?2:3;

// Week-over-week roll rates: of loans in a bucket a week ago, the share that moved one bucket worse, and the share of late loans that became current.
export function rollRates(all:LoanRow[],today:string,weeks=8){
  return Array.from({length:weeks},(_,i)=>{
    const end=addDays(today,-7*i),start=addDays(end,-7);
    const moves=[[0,0],[0,0],[0,0]];let lateBefore=0,cured=0;
    for(const loan of all){
      const before=dpdAsOf(loan,start);if(before===null)continue;
      const after=dpdAsOf(loan,end);const from=bucketOf(before);
      if(from>0){lateBefore++;if(after===null||after===0)cured++;}
      if(from<3){moves[from][0]++;if(after!==null&&bucketOf(after)>from)moves[from][1]++;}
    }
    return {weekEnd:end,currentToLate:pct(moves[0][1],moves[0][0]),currentBase:moves[0][0],d7ToD30:pct(moves[1][1],moves[1][0]),d7Base:moves[1][0],
      d30ToD31:pct(moves[2][1],moves[2][0]),d30Base:moves[2][0],cure:pct(cured,lateBefore),lateBase:lateBefore};
  }).reverse();
}

// Today's target per collector: what fell due up to today and was unpaid at the start of the day; collections count up to that amount per loan.
export function dailyTargets(all:LoanRow[],today:string){
  const map=new Map<string,{id:string;name:string;branch:string;loans:number;target:number;collected:number;received:number}>();
  for(const loan of all){
    if(loan.status!=='active'&&!loan.paidLog.some(p=>p.at===today))continue;
    const due=loan.rows.filter(row=>row.dueAt<=today).reduce((s,row)=>s+Number(row.amount),0);
    const before=loan.paidLog.filter(p=>p.at<today).reduce((s,p)=>s+Number(p.amount),0);
    const paidToday=loan.paidLog.filter(p=>p.at===today).reduce((s,p)=>s+Number(p.amount),0);
    const target=Math.max(0,due-before);
    const o=map.get(loan.collector_id)??{id:loan.collector_id,name:loan.collector_name,branch:loan.branch_name,loans:0,target:0,collected:0,received:0};
    if(target>0)o.loans++;
    o.target+=target;o.collected+=Math.min(target,paidToday);o.received+=paidToday;
    map.set(loan.collector_id,o);
  }
  return [...map.values()].map(o=>({...o,rate:pct(o.collected,o.target)})).sort((a,b)=>b.rate-a.rate||b.collected-a.collected);
}

export const pct=(part:number,whole:number)=>whole?Math.round(part/whole*1000)/10:0;

export async function portfolioReport(actor:Actor,filter:ReportFilter={}){
  requireRole(actor,['owner','manager']);
  await runPortfolioAccruals();
  const today=todayIso(),{start,end}=weekBounds(today);
  const all=await loans(actor,filter);
  const active=all.filter(loan=>loan.status==='active');
  const outstanding=active.reduce((sum,loan)=>sum+loan.outstanding_principal,0);
  const par=(days:number)=>{const late=active.filter(loan=>dpdOf(loan,today)>=days);return {count:late.length,amount:late.reduce((s,l)=>s+l.outstanding_principal,0),percent:pct(late.reduce((s,l)=>s+l.outstanding_principal,0),outstanding)};};
  const dueThisWeek=all.flatMap(loan=>loan.rows.filter(row=>row.dueAt>=start&&row.dueAt<=end)).reduce((s,row)=>s+Number(row.amount),0);
  const ids=all.map(loan=>loan.id);
  const weekly=(await pool.query(`SELECT to_char(date_trunc('week',(p.created_at AT TIME ZONE 'Asia/Jakarta')::date),'YYYY-MM-DD') AS week,SUM(p.amount)::bigint AS total
    FROM payments p WHERE p.status<>'rejected' AND p.application_id=ANY($1) GROUP BY 1`,[ids])).rows;
  const thisWeek=(await pool.query(`SELECT p.application_id AS id,SUM(p.amount)::bigint AS paid FROM payments p WHERE p.status<>'rejected' AND p.application_id=ANY($1)
    AND (p.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $2 AND $3 GROUP BY 1`,[ids,start,end])).rows;
  const paidThisWeek=new Map(thisWeek.map(row=>[row.id as string,Number(row.paid)]));
  const dueOf=(loan:LoanRow)=>loan.rows.filter(row=>row.dueAt>=start&&row.dueAt<=end).reduce((s,row)=>s+Number(row.amount),0);
  // Collection efficiency: per loan, payments count only up to that loan's dues this week.
  const collectedThisWeek=all.reduce((sum,loan)=>sum+Math.min(dueOf(loan),paidThisWeek.get(loan.id)??0),0);
  const receivedThisWeek=[...paidThisWeek.values()].reduce((s,v)=>s+v,0);
  // Cash flow: last 8 weeks of disbursements and collections, next 4 weeks of scheduled inflow.
  const weeks=Array.from({length:12},(_,i)=>addDays(start,(i-7)*7));
  const cashflow=weeks.map(week=>{
    const weekEnd=addDays(week,6);
    const disbursed=all.filter(loan=>loan.disbursed_at&&loan.disbursed_at>=week&&loan.disbursed_at<=weekEnd).reduce((s,l)=>s+l.principal,0);
    const collected=Number(weekly.find(row=>row.week===week)?.total??0);
    const expected=week>=start?active.flatMap(openRows).filter(row=>row.dueAt>=week&&row.dueAt<=weekEnd).reduce((s,row)=>s+row.open,0):0;
    return {week,disbursed,collected,expected,future:week>start};
  });
  const vintageMap=new Map<string,{week:string;loans:number;disbursed:number;due:number;collected:number;late:number;writtenOff:number;paidOff:number}>();
  for(const loan of all){
    if(!loan.disbursed_at)continue;
    const weekday=(new Date(`${loan.disbursed_at}T12:00:00Z`).getUTCDay()+6)%7;
    const week=addDays(loan.disbursed_at,-weekday);
    const v=vintageMap.get(week)??{week,loans:0,disbursed:0,due:0,collected:0,late:0,writtenOff:0,paidOff:0};
    v.loans++;v.disbursed+=loan.principal;v.due+=loan.principal+loan.interest;v.collected+=loan.collected_total;
    if(dpdOf(loan,today)>0)v.late++;if(loan.status==='written_off')v.writtenOff++;if(loan.status==='paid_off'||loan.status==='closed')v.paidOff++;
    vintageMap.set(week,v);
  }
  const vintage=[...vintageMap.values()].sort((a,b)=>b.week.localeCompare(a.week)).map(v=>({...v,repaidPercent:pct(v.collected,v.due)}));
  const officers=new Map<string,{id:string;name:string;branch:string;active:number;outstanding:number;par7:number;due:number;collected:number;pending:number}>();
  for(const loan of all){
    const o=officers.get(loan.collector_id)??{id:loan.collector_id,name:loan.collector_name,branch:loan.branch_name,active:0,outstanding:0,par7:0,due:0,collected:0,pending:0};
    if(loan.status==='active'){o.active++;o.outstanding+=loan.outstanding_principal;if(dpdOf(loan,today)>=7)o.par7++;}
    o.due+=dueOf(loan);o.collected+=Math.min(dueOf(loan),paidThisWeek.get(loan.id)??0);
    officers.set(loan.collector_id,o);
  }
  const perCollector=(await pool.query(`SELECT COALESCE(a.collector_id,a.officer_id) AS collector,
      SUM(p.amount) FILTER (WHERE p.status<>'rejected' AND (p.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $2 AND $3)::bigint AS collected,
      COUNT(*) FILTER (WHERE p.status='pending')::int AS pending
    FROM payments p JOIN applications a ON a.id=p.application_id WHERE p.application_id=ANY($1) GROUP BY 1`,[ids,start,end])).rows;
  for(const row of perCollector){const o=officers.get(row.collector);if(o)o.pending=row.pending;}
  const roll=rollRates(all,today);
  const targets=dailyTargets(all,today);
  return {today,roll,targets,week:{start,end,due:dueThisWeek,collected:collectedThisWeek,received:receivedThisWeek,rate:pct(collectedThisWeek,dueThisWeek)},
    outstanding,activeCount:active.length,par1:par(1),par7:par(7),par30:par(30),cashflow,vintage,
    officers:[...officers.values()].map(o=>({...o,rate:pct(o.collected,o.due)})).sort((a,b)=>b.outstanding-a.outstanding),
    loans:all.map(loan=>({id:loan.id,customer:loan.customer_name,branch:loan.branch_name,collector:loan.collector_name,status:loan.status,principal:loan.principal,
      interest:loan.interest,disbursedAt:loan.disbursed_at,collected:loan.collected_total,receivable:loan.receivable,dpd:dpdOf(loan,today)}))};
}

export async function ledgerSummary(actor:Actor){
  requireRole(actor,['owner']);
  const rows=(await pool.query(`SELECT l.account,SUM(l.debit-l.credit)::bigint AS balance FROM journal_lines l GROUP BY l.account`)).rows;
  const get=(account:string)=>Number(rows.find(row=>row.account===account)?.balance??0);
  return {cash:get('cash'),cashInTransit:get('cash_in_transit'),principal:get('principal_receivable'),interest:get('interest_receivable'),fee:get('fee_receivable'),
    unearned:-get('unearned_interest'),allowance:-get('loan_loss_allowance'),interestIncome:-get('interest_income'),feeIncome:-get('late_fee_income'),
    recoveryIncome:-get('recovery_income'),provisionExpense:get('provision_expense'),badDebt:get('bad_debt_expense'),
    operatingExpense:get('operating_expense'),ownerCapital:-get('owner_capital'),investorCapital:-get('investor_capital'),distributions:get('capital_distributions')};
}

const csvCell=(value:unknown)=>{const text=String(value??'');return /[",;\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;};
// Semicolon separators and a BOM so Excel with Indonesian regional settings opens the file in columns.
export function toCsv(header:string[],rows:unknown[][]){
  return '﻿'+[header,...rows].map(row=>row.map(csvCell).join(';')).join('\r\n');
}

export async function reportCsv(actor:Actor,kind:string,filter:ReportFilter){
  const report=await portfolioReport(actor,filter);
  const statusLabels:Record<string,string>={active:'Aktif',paid_off:'Lunas',closed:'Ditutup',written_off:'Dihapusbukukan'};
  if(kind==='petugas')return toCsv(['Petugas','Cabang','Pinjaman aktif','Pokok beredar','Terlambat 7+ hari','Jatuh tempo minggu ini','Tertagih minggu ini','Tingkat tagih (%)','Menunggu verifikasi'],
    report.officers.map(o=>[o.name,o.branch,o.active,o.outstanding,o.par7,o.due,o.collected,o.rate,o.pending]));
  if(kind==='vintage')return toCsv(['Minggu pencairan','Jumlah pinjaman','Dicairkan','Total kewajiban','Tertagih','Tertagih (%)','Terlambat','Lunas','Dihapusbukukan'],
    report.vintage.map(v=>[v.week,v.loans,v.disbursed,v.due,v.collected,v.repaidPercent,v.late,v.paidOff,v.writtenOff]));
  if(kind==='target')return toCsv(['Penagih','Cabang','Nasabah ditagih','Target','Tertagih','Pencapaian (%)','Total diterima'],report.targets.map(o=>[o.name,o.branch,o.loans,o.target,o.collected,o.rate,o.received]));
  if(kind==='roll-rate')return toCsv(['Minggu berakhir','Lancar ke telat (%)','Basis lancar','Telat 1-7 ke 8-30 (%)','Basis 1-7','Telat 8-30 ke 31+ (%)','Basis 8-30','Pulih (%)','Basis telat'],
    report.roll.map(r=>[r.weekEnd,r.currentToLate,r.currentBase,r.d7ToD30,r.d7Base,r.d30ToD31,r.d30Base,r.cure,r.lateBase]));
  if(kind==='laba'){
    const {profitReport}=await import('./profit');
    const profit=await profitReport(actor,filter);
    return toCsv(['Kelompok','Jenis','Pinjaman','Pokok dicairkan','Pendapatan','Kerugian','Biaya dana','Biaya operasional','Laba bersih','Margin (%)'],
      [...profit.byTenor.map(g=>['Tenor',g.label,g]),...profit.byBranch.map(g=>['Cabang',g.label,g])].map(([type,label,g]:any)=>[label,type,g.loans,g.principal,g.income,g.losses,g.funding,g.operating,g.net,g.margin]));
  }
  if(kind==='arus-kas')return toCsv(['Minggu mulai','Dicairkan','Tertagih','Perkiraan masuk'],report.cashflow.map(w=>[w.week,w.disbursed,w.collected,w.expected]));
  return toCsv(['Nasabah','Cabang','Penagih','Status','Pokok','Bunga','Tanggal cair','Tertagih','Sisa piutang','Hari terlambat'],
    report.loans.map(l=>[l.customer,l.branch,l.collector,statusLabels[l.status]??l.status,l.principal,l.interest,l.disbursedAt??'',l.collected,l.receivable,l.dpd]));
}

// The signed-in officer's target for today, for the top of the collection list.
export async function myDailyTarget(actor:Actor){
  requireRole(actor,['officer']);
  const today=todayIso();
  const mine=dailyTargets(await loans(actor,{}),today).find(o=>o.id===actor.id);
  return mine??{id:actor.id,name:actor.name,branch:'',loans:0,target:0,collected:0,received:0,rate:0};
}
