import {pool} from './db';
import type {Actor} from './auth';

export async function dashboard(actor:Actor){
  const scope=actor.role==='officer'?'WHERE a.officer_id=$1':actor.role==='customer'?'WHERE a.customer_id=$1':actor.role==='manager'?'WHERE a.branch_id=$1':'';
  const params=actor.role==='officer'?[actor.id]:actor.role==='customer'?[actor.customer_id]:actor.role==='manager'?[actor.branch_id]:[];
  const [applications,customers,totals,policy,counts]=await Promise.all([
    pool.query(`SELECT a.id,a.status,a.requested_principal,a.approved_principal,a.interest_amount,a.term_weeks,a.term_months,a.repayment_frequency,a.submitted_at,
      c.name AS customer_name,u.name AS officer_name,ag.snapshot,ag.snapshot_hash,ag.signed_at,
      ie.verification_status,se.signing_method,
      COALESCE((SELECT SUM(p.amount)::bigint FROM payments p WHERE p.application_id=a.id),0) AS paid,
      d.bank_reference AS transfer_reference,
      COALESCE((SELECT SUM(i.principal+i.interest)::bigint FROM installments i WHERE i.application_id=a.id AND i.due_at<(now() AT TIME ZONE 'Asia/Jakarta')::date),0) AS overdue_through_yesterday,
      COALESCE((SELECT json_agg(json_build_object('sequence',i.sequence,'dueAt',i.due_at,'amount',i.principal+i.interest) ORDER BY i.sequence) FROM installments i WHERE i.application_id=a.id),'[]') AS installments,
      COALESCE((SELECT json_agg(json_build_object('id',p.id,'amount',p.amount,'reference',p.bank_reference,'createdAt',p.created_at,'recordedBy',vu.name,'amountSource',p.amount_source,'hasReceipt',pr.payment_id IS NOT NULL) ORDER BY p.created_at)
        FROM payments p JOIN users vu ON vu.id=p.verified_by LEFT JOIN payment_receipts pr ON pr.payment_id=p.id WHERE p.application_id=a.id),'[]') AS payments
      FROM applications a JOIN customers c ON c.id=a.customer_id JOIN users u ON u.id=a.officer_id
      LEFT JOIN LATERAL (SELECT snapshot,snapshot_hash,signed_at FROM agreements WHERE application_id=a.id ORDER BY version DESC LIMIT 1) ag ON true
      LEFT JOIN intake_evidence ie ON ie.application_id=a.id
      LEFT JOIN LATERAL (SELECT s.signing_method FROM signature_evidence s JOIN agreements g ON g.id=s.agreement_id WHERE g.application_id=a.id ORDER BY g.version DESC LIMIT 1) se ON true
      LEFT JOIN disbursements d ON d.application_id=a.id ${scope} ORDER BY a.submitted_at DESC LIMIT 100`,params),
    actor.role==='officer'?pool.query('SELECT id,name FROM customers WHERE branch_id=$1 ORDER BY name',[actor.branch_id]):Promise.resolve({rows:[]}),
    actor.role==='owner'?pool.query(`SELECT
      COALESCE(SUM(CASE WHEN account='cash' THEN debit-credit ELSE 0 END),0)::bigint AS net_cash,
      COALESCE(SUM(CASE WHEN account='principal_receivable' THEN debit-credit ELSE 0 END),0)::bigint AS principal_outstanding,
      COALESCE(SUM(CASE WHEN account='interest_receivable' THEN debit-credit ELSE 0 END),0)::bigint AS interest_receivable
      FROM journal_lines`):Promise.resolve({rows:[]}),
    pool.query('SELECT version,min_principal,max_principal,flat_interest_bps,min_weeks,max_weeks,min_months,max_months,late_fee_monthly_bps,weekly_rates FROM policy_versions ORDER BY version DESC LIMIT 1'),
    actor.role==='owner'?pool.query(`SELECT COUNT(*) FILTER (WHERE status IN ('submitted','signed_pending_approval'))::integer AS pending,
      COUNT(*) FILTER (WHERE status='active')::integer AS active FROM applications`):Promise.resolve({rows:[]})
  ]);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
  return {today,applications:applications.rows,customers:customers.rows,totals:totals.rows[0]??null,policy:policy.rows[0]??null,counts:counts.rows[0]??null};
}
