import type {Actor} from './auth';
import {requireRole} from './auth';
import {pool,transaction} from './db';
import {addDays,runPortfolioAccruals,todayIso} from './accounting';

export type DueItem={id:string;customerId:string;promiseBroken:boolean;customerName:string;phone:string|null;collectorId:string|null;collectorName:string|null;branchId:string;
  remaining:number;fee:number;nextDue:{dueAt:string;amount:number}|null;dpd:number;overdueAmount:number;
  lastVisit:{outcome:string;promiseDate:string|null;note:string|null;at:string}|null;bucket:'late'|'today'|'promise'|'week'|'later'};

export const visitLabels:Record<string,string>={paid:'Bertemu, sudah bayar',promise:'Janji bayar',not_home:'Tidak di rumah',refused:'Menolak bayar',other:'Lainnya'};

function scopeClause(actor:Actor,params:unknown[]){
  if(actor.role==='officer'){params.push(actor.id);return `AND COALESCE(a.collector_id,a.officer_id)=$${params.length}`;}
  if(actor.role==='manager'){params.push(actor.branch_id);return `AND a.branch_id=$${params.length}`;}
  return '';
}

// Active loans for collection work, with schedule coverage computed from non-rejected payments.
export async function dueList(actor:Actor,options:{branchId?:string;collectorId?:string}={}):Promise<DueItem[]>{
  requireRole(actor,['owner','manager','officer']);
  await runPortfolioAccruals();
  const today=todayIso();
  const params:unknown[]=[];
  let where=scopeClause(actor,params);
  if(actor.role==='owner'&&options.branchId){params.push(options.branchId);where+=` AND a.branch_id=$${params.length}`;}
  if(actor.role!=='officer'&&options.collectorId){params.push(options.collectorId);where+=` AND COALESCE(a.collector_id,a.officer_id)=$${params.length}`;}
  const loans=(await pool.query(`SELECT a.id,a.branch_id,a.customer_id,COALESCE(a.collector_id,a.officer_id) AS collector_id,c.name AS customer_name,c.phone,u.name AS collector_name,
      COALESCE((SELECT SUM(principal+interest) FROM payments p WHERE p.application_id=a.id AND p.status<>'rejected'),0)::bigint AS paid,
      COALESCE((SELECT SUM(CASE WHEN l.account IN ('principal_receivable','interest_receivable','fee_receivable') THEN l.debit-l.credit ELSE 0 END)
        FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.application_id=a.id),0)::bigint AS remaining,
      COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.application_id=a.id AND l.account='fee_receivable'),0)::bigint AS fee,
      (SELECT json_build_object('outcome',v.outcome,'promiseDate',to_char(v.promise_date,'YYYY-MM-DD'),'note',v.note,'at',v.created_at)
        FROM collection_visits v WHERE v.application_id=a.id ORDER BY v.created_at DESC LIMIT 1) AS last_visit,
      COALESCE((SELECT json_agg(json_build_object('dueAt',to_char(i.due_at,'YYYY-MM-DD'),'amount',i.principal+i.interest) ORDER BY i.sequence)
        FROM installments i WHERE i.application_id=a.id),'[]') AS rows
    FROM applications a JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=COALESCE(a.collector_id,a.officer_id)
    WHERE a.status='active' ${where}`,params)).rows;
  const weekEnd=addDays(today,7);
  const items=loans.map(loan=>{
    let cumulative=0,nextDue:DueItem['nextDue']=null,overdueAmount=0;
    const paid=Number(loan.paid);
    for(const row of loan.rows as {dueAt:string;amount:number}[]){
      const before=cumulative;cumulative+=Number(row.amount);
      if(cumulative<=paid)continue;
      const open=cumulative-Math.max(before,paid);
      if(!nextDue)nextDue={dueAt:row.dueAt,amount:open};
      if(row.dueAt<today)overdueAmount+=open;
    }
    const dpd=nextDue&&nextDue.dueAt<today?Math.round((Date.parse(`${today}T12:00:00Z`)-Date.parse(`${nextDue.dueAt}T12:00:00Z`))/86400000):0;
    const lastVisit=loan.last_visit;
    const promiseDue=lastVisit?.outcome==='promise'&&lastVisit.promiseDate&&lastVisit.promiseDate<=today;
    // A promise whose date has passed while the loan is still late: call first.
    const promiseBroken=!!(lastVisit?.outcome==='promise'&&lastVisit.promiseDate&&lastVisit.promiseDate<today&&dpd>0);
    const bucket:DueItem['bucket']=dpd>0?'late':nextDue?.dueAt===today?'today':promiseDue?'promise':nextDue&&nextDue.dueAt<=weekEnd?'week':'later';
    return {id:loan.id,customerId:loan.customer_id as string,promiseBroken,customerName:loan.customer_name,phone:loan.phone,collectorId:loan.collector_id,collectorName:loan.collector_name,branchId:loan.branch_id,
      remaining:Number(loan.remaining),fee:Number(loan.fee),nextDue,dpd,overdueAmount:overdueAmount+Number(loan.fee),lastVisit,bucket};
  });
  const order={late:0,today:1,promise:2,week:3,later:4};
  return items.sort((a,b)=>order[a.bucket]-order[b.bucket]||Number(b.promiseBroken)-Number(a.promiseBroken)||b.dpd-a.dpd||(a.nextDue?.dueAt??'').localeCompare(b.nextDue?.dueAt??''));
}

export async function logVisit(actor:Actor|null,applicationId:string,outcome:string,promiseDate:string|null,note:string){
  requireRole(actor,['officer','manager']);
  if(!(outcome in visitLabels)||note.length>500)throw new Error('Invalid visit');
  const today=todayIso();
  if(outcome==='promise'&&(!promiseDate||!/^\d{4}-\d{2}-\d{2}$/.test(promiseDate)||promiseDate<today||promiseDate>addDays(today,14)))throw new Error('Promise date must be within 14 days');
  const app=(await pool.query('SELECT officer_id,collector_id,branch_id,status FROM applications WHERE id=$1',[applicationId])).rows[0];
  if(!app)throw new Error('Application not found');
  if(app.branch_id!==actor.branch_id||(actor.role==='officer'&&(app.collector_id??app.officer_id)!==actor.id))throw new Error('Forbidden');
  if(app.status!=='active')throw new Error('Loan is not active');
  const row=(await pool.query('INSERT INTO collection_visits(application_id,officer_id,outcome,promise_date,note) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [applicationId,actor.id,outcome,outcome==='promise'?promiseDate:null,note.trim()||null])).rows[0];
  return {id:row.id as string};
}

export async function assignCollector(actor:Actor|null,applicationId:string,collectorId:string){
  requireRole(actor,['owner','manager']);
  return transaction(async c=>{
    const app=(await c.query('SELECT id,branch_id,status,collector_id,officer_id FROM applications WHERE id=$1 FOR UPDATE',[applicationId])).rows[0];
    if(!app)throw new Error('Application not found');
    if(actor.role==='manager'&&app.branch_id!==actor.branch_id)throw new Error('Forbidden');
    const collector=(await c.query(`SELECT id FROM users WHERE id=$1 AND role='officer' AND active AND branch_id=$2`,[collectorId,app.branch_id])).rows[0];
    if(!collector)throw new Error('Collector must be an active officer in the loan branch');
    await c.query('UPDATE applications SET collector_id=$1 WHERE id=$2',[collectorId,applicationId]);
    await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',
      [actor.id,'application',applicationId,'collector_assigned',JSON.stringify({collectorId:app.collector_id??app.officer_id}),JSON.stringify({collectorId})]);
    return {id:applicationId};
  });
}

export async function branchOfficers(actor:Actor,branchId?:string){
  requireRole(actor,['owner','manager']);
  const branch=actor.role==='manager'?actor.branch_id:branchId;
  return (await pool.query(`SELECT id,name,branch_id FROM users WHERE role='officer' AND active ${branch?'AND branch_id=$1':''} ORDER BY name`,branch?[branch]:[])).rows as {id:string;name:string;branch_id:string}[];
}

// Monday-based Jakarta week: installments falling due versus payments received on the collector's loans.
export function weekBounds(today=todayIso()){
  const weekday=(new Date(`${today}T12:00:00Z`).getUTCDay()+6)%7;
  const start=addDays(today,-weekday);
  return {start,end:addDays(start,6)};
}

export async function collectorWeek(collectorId:string){
  const {start,end}=weekBounds();
  // Per loan, only payments up to that loan's dues this week count, so early payoffs cannot inflate the rate.
  const row=(await pool.query(`WITH due AS (SELECT a.id,SUM(i.principal+i.interest) AS due FROM installments i JOIN applications a ON a.id=i.application_id
        WHERE COALESCE(a.collector_id,a.officer_id)=$1 AND a.status IN ('active','paid_off','closed') AND i.due_at BETWEEN $2 AND $3 GROUP BY a.id),
      paid AS (SELECT p.application_id AS id,SUM(p.amount) AS paid FROM payments p JOIN applications a ON a.id=p.application_id
        WHERE COALESCE(a.collector_id,a.officer_id)=$1 AND p.status<>'rejected' AND (p.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $2 AND $3 GROUP BY p.application_id)
    SELECT COALESCE(SUM(due.due),0)::bigint AS due,COALESCE(SUM(LEAST(due.due,COALESCE(paid.paid,0))),0)::bigint AS collected,
      (SELECT COALESCE(SUM(paid),0) FROM paid)::bigint AS received FROM due LEFT JOIN paid ON paid.id=due.id`,
    [collectorId,start,end])).rows[0];
  return {start,end,due:Number(row.due),collected:Number(row.collected),received:Number(row.received)};
}

export {whatsappLink} from './whatsapp';
