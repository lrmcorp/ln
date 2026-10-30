import type {Actor} from './auth';
import {requireRole} from './auth';
import {pool} from './db';
import {borrowerGrade,gradeColumns} from './grade';

// Everything about one borrower on one screen: grade, every loan, payments and field visits.
// Owners see all; managers their branch; officers only borrowers they originated or collect.
export async function customerProfile(actor:Actor,customerId:string){
  requireRole(actor,['owner','manager','officer']);
  const customer=(await pool.query(`SELECT c.id,c.name,c.phone,c.weekly_income,c.created_at,c.branch_id,b.name AS branch,${gradeColumns}
    FROM customers c JOIN branches b ON b.id=c.branch_id WHERE c.id=$1`,[customerId])).rows[0];
  if(!customer)throw new Error('Not found');
  if(actor.role==='manager'&&customer.branch_id!==actor.branch_id)throw new Error('Forbidden');
  if(actor.role==='officer'&&!(await pool.query(`SELECT 1 FROM applications WHERE customer_id=$1 AND (officer_id=$2 OR collector_id=$2)`,[customerId,actor.id])).rows[0])throw new Error('Forbidden');
  const loans=(await pool.query(`SELECT a.id,a.status,COALESCE(a.approved_principal,a.requested_principal)::bigint AS principal,COALESCE(a.interest_amount,0)::bigint AS interest,
      a.term_weeks,a.max_dpd,to_char(a.submitted_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS submitted,to_char(a.disbursed_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS disbursed,
      u.name AS collector,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.application_id=a.id AND p.status<>'rejected'),0)::bigint AS paid,
      COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.application_id=a.id
        AND l.account IN ('principal_receivable','interest_receivable','fee_receivable')),0)::bigint AS remaining
    FROM applications a LEFT JOIN users u ON u.id=COALESCE(a.collector_id,a.officer_id) WHERE a.customer_id=$1 ORDER BY a.submitted_at DESC`,[customerId])).rows
    .map(row=>({...row,principal:Number(row.principal),interest:Number(row.interest),paid:Number(row.paid),remaining:Number(row.remaining)}));
  const payments=(await pool.query(`SELECT p.id,p.application_id,p.amount::bigint AS amount,p.method,p.status,p.created_at,u.name AS recorded_by,p.review_note
    FROM payments p JOIN applications a ON a.id=p.application_id JOIN users u ON u.id=p.verified_by WHERE a.customer_id=$1 ORDER BY p.created_at DESC LIMIT 50`,[customerId])).rows
    .map(row=>({...row,amount:Number(row.amount)}));
  const visits=(await pool.query(`SELECT v.id,v.outcome,to_char(v.promise_date,'YYYY-MM-DD') AS promise_date,v.note,v.created_at,u.name AS officer
    FROM collection_visits v JOIN applications a ON a.id=v.application_id JOIN users u ON u.id=v.officer_id WHERE a.customer_id=$1 ORDER BY v.created_at DESC LIMIT 30`,[customerId])).rows;
  await pool.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action) VALUES($1,$2,$3,$4)',[actor.id,'customer',customerId,'profile_viewed']);
  const grade=borrowerGrade({loans:customer.grade_loans,worstDpd:customer.grade_worst_dpd,writtenOff:customer.grade_written_off});
  return {customer:{id:customer.id as string,name:customer.name as string,phone:customer.phone as string|null,weeklyIncome:Number(customer.weekly_income??0),
    since:customer.created_at as string,branch:customer.branch as string},grade,loans,payments,visits};
}
