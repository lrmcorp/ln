import {pool} from './db';
import type {Actor} from './auth';
import {runPortfolioAccruals} from './accounting';
import {gradeColumns} from './grade';

const balance=(accounts:string)=>`COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.application_id=a.id AND l.account IN (${accounts})),0)::bigint`;

export async function dashboard(actor:Actor){
  if(actor.role==='customer') throw new Error('Forbidden');
  await runPortfolioAccruals();
  const scope=actor.role==='officer'?'WHERE (a.officer_id=$1 OR a.collector_id=$1)':actor.role==='manager'?'WHERE a.branch_id=$1':'';
  const params=actor.role==='officer'?[actor.id]:actor.role==='manager'?[actor.branch_id]:[];
  const [applications,totals,policy,counts,officers]=await Promise.all([
    pool.query(`SELECT a.id,a.customer_id,a.status,a.requested_principal,a.approved_principal,a.interest_amount,a.term_weeks,a.term_months,a.repayment_frequency,a.submitted_at,a.branch_id,
      a.officer_id,COALESCE(a.collector_id,a.officer_id) AS collector_id,cu.name AS collector_name,a.written_off_amount,
      c.name AS customer_name,c.phone AS customer_phone,u.name AS officer_name,ag.snapshot,ag.snapshot_hash,ag.signed_at,
      ie.verification_status,se.signing_method,pl.latitude::float AS place_lat,pl.longitude::float AS place_lng,(pl.photo_cipher IS NOT NULL) AS has_place_photo,
      COALESCE((SELECT SUM(p.principal+p.interest)::bigint FROM payments p WHERE p.application_id=a.id AND p.status<>'rejected'),0) AS paid,
      COALESCE((SELECT SUM(p.recovery)::bigint FROM payments p WHERE p.application_id=a.id AND p.status<>'rejected'),0) AS recovered,
      COALESCE((SELECT COUNT(*) FROM payments p WHERE p.application_id=a.id AND p.status='pending'),0)::int AS pending_payments,
      ${balance("'principal_receivable','interest_receivable','fee_receivable'")} AS remaining,
      ${balance("'fee_receivable'")} AS fee,
      ${balance("'principal_receivable','interest_receivable','fee_receivable','unearned_interest'")} AS payoff_quote,
      EXISTS(SELECT 1 FROM agreements r WHERE r.application_id=a.id AND r.kind='restructure' AND r.signed_at IS NULL) AS restructure_pending,
      d.bank_reference AS transfer_reference,${gradeColumns},
      COALESCE((SELECT SUM(i.principal+i.interest)::bigint FROM installments i WHERE i.application_id=a.id AND i.due_at<(now() AT TIME ZONE 'Asia/Jakarta')::date),0) AS overdue_through_yesterday,
      COALESCE((SELECT json_agg(json_build_object('sequence',i.sequence,'dueAt',i.due_at,'amount',i.principal+i.interest) ORDER BY i.sequence) FROM installments i WHERE i.application_id=a.id),'[]') AS installments,
      COALESCE((SELECT json_agg(json_build_object('id',p.id,'amount',p.amount,'reference',p.bank_reference,'createdAt',p.created_at,'recordedBy',vu.name,'amountSource',p.amount_source,
          'status',p.status,'method',p.method,'fee',p.fee,'recovery',p.recovery,'earlyPayoff',p.early_payoff,'reviewNote',p.review_note,'hasReceipt',pr.payment_id IS NOT NULL) ORDER BY p.created_at)
        FROM payments p JOIN users vu ON vu.id=p.verified_by LEFT JOIN payment_receipts pr ON pr.payment_id=p.id WHERE p.application_id=a.id),'[]') AS payments
      FROM applications a JOIN customers c ON c.id=a.customer_id JOIN users u ON u.id=a.officer_id LEFT JOIN users cu ON cu.id=COALESCE(a.collector_id,a.officer_id)
      LEFT JOIN LATERAL (SELECT snapshot,snapshot_hash,signed_at FROM agreements WHERE application_id=a.id AND kind='original' ORDER BY version DESC LIMIT 1) ag ON true
      LEFT JOIN intake_evidence ie ON ie.application_id=a.id LEFT JOIN intake_place pl ON pl.application_id=a.id
      LEFT JOIN LATERAL (SELECT s.signing_method FROM signature_evidence s JOIN agreements g ON g.id=s.agreement_id WHERE g.application_id=a.id ORDER BY g.version DESC LIMIT 1) se ON true
      LEFT JOIN disbursements d ON d.application_id=a.id ${scope} ORDER BY a.submitted_at DESC LIMIT 200`,params),
    actor.role==='owner'?pool.query(`SELECT
      COALESCE(SUM(CASE WHEN account='cash' THEN debit-credit ELSE 0 END),0)::bigint AS net_cash,
      COALESCE(SUM(CASE WHEN account='principal_receivable' THEN debit-credit ELSE 0 END),0)::bigint AS principal_outstanding,
      COALESCE(SUM(CASE WHEN account='interest_receivable' THEN debit-credit ELSE 0 END),0)::bigint AS interest_receivable
      FROM journal_lines`):Promise.resolve({rows:[]}),
    pool.query('SELECT version,min_principal,max_principal,flat_interest_bps,min_weeks,max_weeks,min_months,max_months,late_fee_monthly_bps,weekly_rates,first_loan_max,repeat_growth_bps,max_installment_income_bps FROM policy_versions ORDER BY version DESC LIMIT 1'),
    actor.role!=='officer'?pool.query(`SELECT COUNT(*) FILTER (WHERE a.status IN ('submitted','signed_pending_approval'))::integer AS pending,
      COUNT(*) FILTER (WHERE a.status='active')::integer AS active,
      (SELECT COUNT(*) FROM payments p JOIN applications pa ON pa.id=p.application_id WHERE p.status='pending' ${actor.role==='manager'?'AND pa.branch_id=$1':''})::integer AS unverified,
      (SELECT COUNT(*) FROM cash_deposits cd WHERE cd.status='pending' ${actor.role==='manager'?'AND cd.branch_id=$1':''})::integer AS deposits
      FROM applications a ${actor.role==='manager'?'WHERE a.branch_id=$1':''}`,actor.role==='manager'?[actor.branch_id]:[]):Promise.resolve({rows:[]}),
    actor.role!=='officer'?pool.query(`SELECT id,name,branch_id FROM users WHERE role='officer' AND active ${actor.role==='manager'?'AND branch_id=$1':''} ORDER BY name`,actor.role==='manager'?[actor.branch_id]:[]):Promise.resolve({rows:[]})
  ]);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
  return {today,applications:applications.rows,totals:totals.rows[0]??null,policy:policy.rows[0]??null,counts:counts.rows[0]??null,officers:officers.rows};
}
