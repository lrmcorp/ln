import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Actor} from './auth';
import {requireRole} from './auth';
import {pool,transaction} from './db';
import {canonicalJson,jakartaToday} from './finance';
import {A,cr,dr,journal,loanBalances} from './ledger';
import {monthlyLateFee,rupiah} from './terms';

export const WRITE_OFF_MIN_DPD=30;
// Loss allowance by days past due, as a share of outstanding principal.
export const PROVISION_BUCKETS=[{minDpd:61,bps:10000},{minDpd:31,bps:5000},{minDpd:8,bps:2500},{minDpd:1,bps:500},{minDpd:0,bps:100}];
export const provisionBps=(dpd:number)=>PROVISION_BUCKETS.find(bucket=>dpd>=bucket.minDpd)!.bps;

export const isoDay=(date:Date)=>date.toISOString().slice(0,10);
export const todayIso=()=>isoDay(jakartaToday());
export const addDays=(day:string,days:number)=>isoDay(new Date(Date.parse(`${day}T12:00:00Z`)+days*86400000));
export const daysBetween=(from:string,to:string)=>Math.round((Date.parse(`${to}T12:00:00Z`)-Date.parse(`${from}T12:00:00Z`))/86400000);

export type ScheduleState={rows:{id:string;sequence:number;dueAt:string;principal:number;interest:number;recognized:boolean}[];
  paidSchedule:number;firstUnpaidDue:string|null;dpd:number;nextDue:{dueAt:string;amount:number}|null};

// Payments (other than rejected ones) cover installments in order; the first uncovered one drives days past due.
export async function scheduleState(c:PoolClient,appId:string,today:string):Promise<ScheduleState>{
  const rows=(await c.query(`SELECT id,sequence,to_char(due_at,'YYYY-MM-DD') AS due,principal,interest,interest_recognized
    FROM installments WHERE application_id=$1 ORDER BY sequence`,[appId])).rows
    .map(row=>({id:row.id as string,sequence:row.sequence as number,dueAt:row.due as string,principal:Number(row.principal),interest:Number(row.interest),recognized:row.interest_recognized as boolean}));
  const paidSchedule=Number((await c.query(`SELECT COALESCE(SUM(principal+interest),0)::bigint AS paid FROM payments WHERE application_id=$1 AND status<>'rejected'`,[appId])).rows[0].paid);
  let cumulative=0,firstUnpaidDue:string|null=null,nextDue:ScheduleState['nextDue']=null;
  for(const row of rows){
    const before=cumulative;cumulative+=row.principal+row.interest;
    if(cumulative>paidSchedule&&!firstUnpaidDue){firstUnpaidDue=row.dueAt;nextDue={dueAt:row.dueAt,amount:cumulative-Math.max(before,paidSchedule)};}
  }
  const dpd=firstUnpaidDue&&firstUnpaidDue<today?daysBetween(firstUnpaidDue,today):0;
  return {rows,paidSchedule,firstUnpaidDue,dpd,nextDue};
}

async function setProvision(c:PoolClient,appId:string,target:number,dpd:number){
  const balances=await loanBalances(c,appId);
  const delta=target-balances.allowance;
  if(!delta)return;
  const adjustment=(await c.query('INSERT INTO provision_adjustments(application_id,dpd,target,delta) VALUES($1,$2,$3,$4) RETURNING id',[appId,dpd,target,delta])).rows[0];
  await journal(c,appId,'provision',adjustment.id,delta>0?[dr(A.provisionExpense,delta),cr(A.allowance,delta)]:[dr(A.allowance,-delta),cr(A.provisionExpense,-delta)]);
}

export async function releaseProvision(c:PoolClient,appId:string){await setProvision(c,appId,0,0);}

// Idempotent daily posting for one locked, active loan: earned interest, late fees, provision, worst DPD.
export async function runAccruals(c:PoolClient,app:Record<string,any>,today=todayIso()){
  if(app.status!=='active')return;
  const state=await scheduleState(c,app.id,today);
  if(app.interest_deferred){
    let unearned=(await loanBalances(c,app.id)).unearned;
    for(const row of state.rows){
      if(row.recognized||row.dueAt>today)continue;
      // Capped at the remaining unearned balance; restructured schedules also carry already-earned interest.
      const amount=Math.min(row.interest,unearned);
      await journal(c,app.id,'interest_recognition',row.id,[dr(A.unearned,amount),cr(A.interestIncome,amount)]);
      unearned-=amount;
      await c.query('UPDATE installments SET interest_recognized=true WHERE id=$1',[row.id]);
    }
  }
  const agreement=(await c.query(`SELECT snapshot FROM agreements WHERE application_id=$1 AND signed_at IS NOT NULL ORDER BY version ASC LIMIT 1`,[app.id])).rows[0];
  const feeBps=Number(agreement?.snapshot?.lateFeeMonthlyBps??0);
  const accruedThrough:string|null=app.fee_accrued_through?isoDay(new Date(app.fee_accrued_through)):null;
  if(feeBps>0&&state.firstUnpaidDue&&state.firstUnpaidDue<today){
    const start=accruedThrough&&accruedThrough>state.firstUnpaidDue?accruedThrough:state.firstUnpaidDue;
    const days=daysBetween(start,today);
    if(days>0){
      const principal=Number(app.approved_principal);
      const accrued=Number((await c.query('SELECT COALESCE(SUM(amount),0)::bigint AS total FROM late_fee_accruals WHERE application_id=$1',[app.id])).rows[0].total);
      // Total late fees never exceed the original principal.
      const amount=Math.max(0,Math.min(monthlyLateFee(principal,feeBps,days),principal-accrued));
      const accrual=(await c.query('INSERT INTO late_fee_accruals(application_id,from_date,through_date,days,amount) VALUES($1,$2,$3,$4,$5) RETURNING id',[app.id,start,today,days,amount])).rows[0];
      await journal(c,app.id,'late_fee',accrual.id,[dr(A.fee,amount),cr(A.feeIncome,amount)]);
    }
  }
  await c.query('UPDATE applications SET fee_accrued_through=$1,max_dpd=GREATEST(max_dpd,$2) WHERE id=$3',[today,state.dpd,app.id]);
  app.fee_accrued_through=today;
  const balances=await loanBalances(c,app.id);
  await setProvision(c,app.id,Math.round(balances.principal*provisionBps(state.dpd)/10000),state.dpd);
}

let lastPortfolioRun=0;
// Brings every active loan up to date; throttled because page loads call it.
export async function runPortfolioAccruals(force=false){
  if(!force&&Date.now()-lastPortfolioRun<60000)return;
  lastPortfolioRun=Date.now();
  const ids=(await pool.query(`SELECT id FROM applications WHERE status='active'`)).rows.map(row=>row.id as string);
  for(const id of ids)await transaction(async c=>{
    const app=(await c.query('SELECT * FROM applications WHERE id=$1 FOR UPDATE',[id])).rows[0];
    await runAccruals(c,app);
  });
}

export function earlyPayoffQuote(balances:{principal:number;interest:number;unearned:number;fee:number}){
  return balances.principal+balances.interest-balances.unearned+balances.fee;
}

export async function writeOff(actor:Actor|null,applicationId:string,reason:string){
  requireRole(actor,['owner']);
  if(!reason.trim())throw new Error('Reason required');
  return transaction(async c=>{
    const app=(await c.query('SELECT * FROM applications WHERE id=$1 FOR UPDATE',[applicationId])).rows[0];
    if(!app)throw new Error('Application not found');
    if(app.status!=='active')throw new Error('Loan is not active');
    await runAccruals(c,app);
    const state=await scheduleState(c,app.id,todayIso());
    if(state.dpd<WRITE_OFF_MIN_DPD)throw new Error('Write-off requires 30 days past due');
    const b=await loanBalances(c,app.id);
    const amount=b.principal+b.interest+b.fee;
    const expense=amount-b.unearned-b.allowance;
    await journal(c,app.id,'write_off',app.id,[dr(A.unearned,b.unearned),dr(A.allowance,b.allowance),dr(A.badDebtExpense,expense),
      cr(A.principal,b.principal),cr(A.interest,b.interest),cr(A.fee,b.fee)]);
    await c.query(`UPDATE applications SET status='written_off',written_off_at=now(),written_off_amount=$2 WHERE id=$1`,[app.id,amount]);
    await c.query(`UPDATE location_shares SET enabled=false,stopped_at=now(),latitude=NULL,longitude=NULL,accuracy_m=NULL,reported_at=NULL,updated_at=now()
      WHERE customer_id=$1 AND NOT EXISTS(SELECT 1 FROM applications WHERE customer_id=$1 AND status='active')`,[app.customer_id]);
    await c.query(`UPDATE mobile_devices SET revoked_at=now(),sharing_enabled=false
      WHERE customer_id=$1 AND revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM applications WHERE customer_id=$1 AND status='active')`,[app.customer_id]);
    await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,before_data,after_data,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [actor.id,'application',app.id,'written_off',JSON.stringify({status:'active',dpd:state.dpd}),JSON.stringify({status:'written_off',amount,expense}),reason.trim()]);
    return {id:app.id,amount};
  });
}

function split(total:number,parts:number){
  return Array.from({length:parts},(_,i)=>Math.floor(total/parts)+(i<total%parts?1:0));
}

export function restructureTerms(name:string,remaining:{principal:number;interest:number;fee:number},weeks:number,accountLast4:string){
  if(!Number.isSafeInteger(weeks)||weeks<1||weeks>52)throw new Error('Invalid restructure');
  const principals=split(remaining.principal,weeks),interests=split(remaining.interest,weeks);
  const schedule=principals.map((principal,i)=>({sequence:i+1,principal,interest:interests[i]}));
  const total=remaining.principal+remaining.interest;
  const terms=[
    `Nasabah: ${name}. Sisa kewajiban pokok ${rupiah(remaining.principal)} dan bunga ${rupiah(remaining.interest)}, total ${rupiah(total)}, dijadwalkan ulang tanpa bunga tambahan.`,
    `Sisa kewajiban dicicil ${weeks} kali setiap minggu. Angsuran pertama jatuh tempo 7 hari setelah restrukturisasi ini ditandatangani, lalu setiap 7 hari berikutnya.`,
    remaining.fee>0?`Denda keterlambatan yang sudah tercatat sebesar ${rupiah(remaining.fee)} tetap terutang dan dibayar lebih dulu dari setiap pembayaran.`:'Tidak ada denda keterlambatan yang terutang saat ini.',
    'Ketentuan denda dan hak lain dalam perjanjian awal tetap berlaku. Restrukturisasi ini berlaku setelah ditandatangani nasabah. Dokumen ini adalah simulasi pengembangan dan bukan tanda tangan elektronik sah.'
  ];
  const snapshot={kind:'restructure',principal:remaining.principal,interest:remaining.interest,total,weeks,feeOutstanding:remaining.fee,schedule,accountLast4,terms};
  return {snapshot,hash:createHash('sha256').update(canonicalJson(snapshot)).digest('hex'),terms};
}

async function remainingForRestructure(c:PoolClient,appId:string){
  const b=await loanBalances(c,appId);
  return {principal:b.principal,interest:b.interest,fee:b.fee};
}

export async function proposeRestructure(actor:Actor|null,applicationId:string,weeks:number,reason:string){
  requireRole(actor,['owner']);
  if(!reason.trim())throw new Error('Reason required');
  return transaction(async c=>{
    const app=(await c.query('SELECT a.*,c.name AS customer_name,c.account_last4 FROM applications a JOIN customers c ON c.id=a.customer_id WHERE a.id=$1 FOR UPDATE OF a',[applicationId])).rows[0];
    if(!app)throw new Error('Application not found');
    if(app.status!=='active')throw new Error('Loan is not active');
    await runAccruals(c,app);
    await c.query(`DELETE FROM agreements WHERE application_id=$1 AND kind='restructure' AND signed_at IS NULL`,[app.id]);
    const remaining=await remainingForRestructure(c,app.id);
    if(remaining.principal+remaining.interest<=0)throw new Error('Nothing left to restructure');
    const quote=restructureTerms(app.customer_name,remaining,weeks,app.account_last4??'');
    const version=Number((await c.query('SELECT COALESCE(MAX(version),0) AS v FROM agreements WHERE application_id=$1',[app.id])).rows[0].v)+1;
    await c.query(`INSERT INTO agreements(application_id,version,snapshot,snapshot_hash,kind) VALUES($1,$2,$3,$4,'restructure')`,[app.id,version,JSON.stringify(quote.snapshot),quote.hash]);
    await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data,reason) VALUES($1,$2,$3,$4,$5,$6)',
      [actor.id,'application',app.id,'restructure_proposed',JSON.stringify({weeks,hash:quote.hash,...remaining}),reason.trim()]);
    return {id:app.id,hash:quote.hash};
  });
}

export async function pendingRestructure(c:PoolClient,appId:string){
  return (await c.query(`SELECT * FROM agreements WHERE application_id=$1 AND kind='restructure' AND signed_at IS NULL ORDER BY version DESC LIMIT 1`,[appId])).rows[0]??null;
}

// Called inside the signing transaction once the borrower accepted the exact pending snapshot.
export async function applyRestructure(c:PoolClient,app:Record<string,any>,agreement:Record<string,any>,actorId:string|null){
  const remaining=await remainingForRestructure(c,app.id);
  const snapshot=agreement.snapshot;
  if(remaining.principal!==Number(snapshot.principal)||remaining.interest!==Number(snapshot.interest))throw new Error('Terms changed; review again');
  const today=todayIso();
  const paid=(await c.query(`SELECT COALESCE(SUM(principal),0)::bigint AS p,COALESCE(SUM(interest),0)::bigint AS i FROM payments WHERE application_id=$1 AND status<>'rejected'`,[app.id])).rows[0];
  await c.query('DELETE FROM installments WHERE application_id=$1',[app.id]);
  let sequence=1;
  // One settled row keeps payments already made aligned with the new weekly rows.
  if(Number(paid.p)+Number(paid.i)>0)await c.query('INSERT INTO installments(application_id,sequence,due_at,principal,interest,interest_recognized) VALUES($1,$2,$3,$4,$5,true)',[app.id,sequence++,today,paid.p,paid.i]);
  for(const item of snapshot.schedule)await c.query('INSERT INTO installments(application_id,sequence,due_at,principal,interest) VALUES($1,$2,$3,$4,$5)',
    [app.id,sequence++,addDays(today,7*item.sequence),item.principal,item.interest]);
  await c.query('UPDATE agreements SET signed_at=now(),signed_by=$1 WHERE id=$2',[actorId,agreement.id]);
  await c.query('UPDATE applications SET fee_accrued_through=$1 WHERE id=$2',[today,app.id]);
}
