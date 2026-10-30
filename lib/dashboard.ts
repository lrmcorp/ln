import type {Actor} from './auth';
import {pool} from './db';
import {addDays,todayIso} from './accounting';
import {portfolioReport,loans,openRows,dpdOf,scope,pct,type ReportFilter} from './reports';

const ownerSteps:Record<string,string>={submitted:'Putuskan pengajuan',signed_pending_approval:'Setujui syarat yang ditandatangani',signed:'Cairkan dana',
  release_authorized:'Cairkan dana',transfer_initiated:'Konfirmasi transfer',paid_off:'Tutup pinjaman lunas'};

// Beranda for owners and managers: cash in this month against last month, risk, upcoming dues, and the short list of things waiting on them.
export async function homeDashboard(actor:Actor,filter:ReportFilter={}){
  const report=await portfolioReport(actor,filter);
  const today=report.today;
  const monthStart=`${today.slice(0,8)}01`;
  const lastMonthStart=(()=>{const [y,m]=today.split('-').map(Number);return m===1?`${y-1}-12-01`:`${y}-${String(m-1).padStart(2,'0')}-01`;})();
  const {params,where}=scope(actor,filter);
  const daily=(await pool.query(`SELECT to_char((p.created_at AT TIME ZONE 'Asia/Jakarta')::date,'YYYY-MM-DD') AS day,SUM(p.amount)::bigint AS total
      FROM payments p JOIN applications a ON a.id=p.application_id
      WHERE p.status<>'rejected' AND (p.created_at AT TIME ZONE 'Asia/Jakarta')::date>=$${params.length+1}::date ${where} GROUP BY 1`,[...params,lastMonthStart])).rows;
  const byDay=new Map(daily.map(row=>[row.day as string,Number(row.total)]));
  const daysIn=(start:string)=>{const [y,m]=start.split('-').map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate();};
  const series=(start:string,lastDay:number)=>{let sum=0;return Array.from({length:lastDay},(_,i)=>{sum+=byDay.get(addDays(start,i))??0;return sum;});};
  const todayDay=Number(today.slice(8,10));
  const thisMonth=series(monthStart,todayDay);
  const lastMonth=series(lastMonthStart,daysIn(lastMonthStart));
  const monthIn=thisMonth.at(-1)??0;
  const lastSamePeriod=lastMonth[Math.min(todayDay,lastMonth.length)-1]??0;
  const income=(await pool.query(`SELECT COALESCE(SUM(l.credit-l.debit),0)::bigint AS total FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN applications a ON a.id=j.application_id
      WHERE l.account IN ('interest_income','late_fee_income','recovery_income') AND (j.created_at AT TIME ZONE 'Asia/Jakarta')::date>=$${params.length+1}::date ${where}`,[...params,monthStart])).rows[0];
  const all=await loans(actor,filter);
  const weekEnd=addDays(today,6);
  const upcoming=all.filter(loan=>loan.status==='active').flatMap(loan=>openRows(loan).filter(row=>row.open>0&&row.dueAt>=today&&row.dueAt<=weekEnd)
    .map(row=>({id:loan.id,customer:loan.customer_name,collector:loan.collector_name,dueAt:row.dueAt,amount:row.open}))).sort((a,b)=>a.dueAt.localeCompare(b.dueAt)||b.amount-a.amount);
  const late=all.filter(loan=>dpdOf(loan,today)>0).map(loan=>({id:loan.id,customer:loan.customer_name,collector:loan.collector_name,dpd:dpdOf(loan,today),
    overdue:openRows(loan).filter(row=>row.dueAt<today).reduce((s,row)=>s+row.open,0)})).sort((a,b)=>b.dpd-a.dpd);
  const pipeline=(await pool.query(`SELECT a.id,a.status,c.name AS customer,COALESCE(a.approved_principal,a.requested_principal)::bigint AS principal
      FROM applications a JOIN customers c ON c.id=a.customer_id WHERE a.status = ANY($${params.length+1}) ${where} ORDER BY a.submitted_at`,
    [...params,actor.role==='owner'?Object.keys(ownerSteps):['awaiting_signature','submitted','signed_pending_approval','signed','release_authorized','transfer_initiated']])).rows;
  const verify=(await pool.query(`SELECT
      (SELECT COUNT(*) FROM payments p JOIN applications a ON a.id=p.application_id WHERE p.status='pending' ${where})::int AS payments,
      (SELECT COUNT(*) FROM cash_deposits d WHERE d.status='pending' ${actor.role==='manager'||filter.branchId?`AND d.branch_id=$1`:''})::int AS deposits`,
    actor.role==='manager'||filter.branchId?[params[0]]:[])).rows[0];
  const paidOffMonth=all.filter(loan=>['paid_off','closed'].includes(loan.status)).length;
  return {today,generatedAt:new Date().toISOString(),
    cash:{today:byDay.get(today)??0,month:monthIn,lastSamePeriod,change:lastSamePeriod?Math.round((monthIn-lastSamePeriod)/lastSamePeriod*1000)/10:null,
      income:Number(income.total),thisMonth,lastMonth,monthStart,lastMonthStart},
    outstanding:report.outstanding,activeCount:report.activeCount,par1:report.par1,par7:report.par7,par30:report.par30,
    week:report.week,
    counts:{active:report.activeCount,late:late.length,inProcess:pipeline.length,finished:paidOffMonth,writtenOff:all.filter(loan=>loan.status==='written_off').length},
    upcoming:upcoming.slice(0,6),upcomingTotal:upcoming.reduce((s,row)=>s+row.amount,0),upcomingCount:upcoming.length,
    late:late.slice(0,5),
    pipeline:pipeline.map(row=>({id:row.id as string,customer:row.customer as string,principal:Number(row.principal),status:row.status as string,step:ownerSteps[row.status]??'Menunggu tanda tangan nasabah'})),
    verify:{payments:verify.payments,deposits:verify.deposits},
    collectionRate:pct(report.week.collected,report.week.due)};
}
export type HomeDashboard=Awaited<ReturnType<typeof homeDashboard>>;
