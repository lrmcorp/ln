import type {PoolClient} from 'pg';
import type {Actor} from './auth';
import {requireRole} from './auth';
import {pool,transaction} from './db';
import {allocatePayment} from './finance';
import {imageMime,protect,reveal} from './protected-data';
import {readReceiptAmount} from './receipt-reader';
import {A,cr,dr,journal,loanBalances} from './ledger';
import {earlyPayoffQuote,runAccruals,todayIso} from './accounting';
import {audit,closeIfSettled,inScope,locked,setStatus} from './workflow';

const maxReceiptBytes=5*1024*1024;
export function receiptMime(data:Uint8Array){
  if(data.length>=5&&Buffer.from(data.subarray(0,5)).toString('ascii')==='%PDF-')return 'application/pdf';
  return imageMime(data);
}

export type AmountSource='entered'|'read_confirmed'|'read_auto';
export type PaymentMethod='transfer'|'cash';

function validReceipt(receipt:Uint8Array){
  const mime=receipt.length>=12&&receipt.length<=maxReceiptBytes?receiptMime(receipt):null;
  if(!mime) throw new Error('Invalid receipt');
  return mime;
}

const collectible=(status:string)=>status==='active'||status==='written_off';

export async function assertCanRecordPayment(actor:Actor|null,applicationId:string){
  requireRole(actor,['owner','manager','officer']);
  const app=(await pool.query('SELECT officer_id,collector_id,branch_id,customer_id,status FROM applications WHERE id=$1',[applicationId])).rows[0];
  if(!app) throw new Error('Application not found');
  inScope(actor,app);
  if(!collectible(app.status)) throw new Error('Loan is not active');
}

// Reads a suggested amount for the form; nothing is stored.
export async function readReceiptForPayment(actor:Actor|null,applicationId:string,receipt:Uint8Array){
  await assertCanRecordPayment(actor,applicationId);
  if(validReceipt(receipt)==='application/pdf') return null;
  return readReceiptAmount(receipt);
}

export type PaymentOptions={reference?:string|null;source?:AmountSource;method?:PaymentMethod;earlyPayoff?:boolean};

// Every repayment needs a receipt. A blank amount is read from the receipt image and stored as read_auto.
// Officer-recorded and auto-read payments stay pending until a manager or the owner verifies them (maker-checker).
export async function recordPayment(actor:Actor|null,applicationId:string,amount:number|null,receipt:Uint8Array,options:PaymentOptions={}){
  requireRole(actor,['owner','manager','officer']);
  const reference=options.reference??null,method=options.method??'transfer';
  let source=options.source??'entered';
  if((amount!==null&&(!Number.isSafeInteger(amount)||amount<=0))||(reference!==null&&(!reference.trim()||reference.length>100))||!['transfer','cash'].includes(method)) throw new Error('Invalid payment');
  const mime=validReceipt(receipt);
  if(amount===null){
    await assertCanRecordPayment(actor,applicationId);
    const read=mime==='application/pdf'?null:await readReceiptAmount(receipt);
    if(!read) throw new Error('Receipt amount unreadable');
    amount=read.amount;source='read_auto';
  }
  const paid=amount;
  return transaction(async c=>{
    const app=await locked(c,applicationId);
    inScope(actor,app);
    if(!collectible(app.status)) throw new Error('Loan is not active');
    const status=actor.role==='officer'||source==='read_auto'?'pending':'verified';
    const ref=reference?.trim()||null;
    const debitAccount=method==='cash'?A.cashInTransit:A.cash;
    let allocation={fee:0,interest:0,principal:0},recovery=0,waived=0,remaining=0;
    if(app.status==='written_off'){
      const recovered=Number((await c.query(`SELECT COALESCE(SUM(recovery),0)::bigint AS total FROM payments WHERE application_id=$1 AND status<>'rejected'`,[app.id])).rows[0].total);
      if(paid>Number(app.written_off_amount)-recovered) throw new Error('Overpayment requires review');
      recovery=paid;remaining=Number(app.written_off_amount)-recovered-paid;
    }else{
      await runAccruals(c,app);
      let balances=await loanBalances(c,app.id);
      if(options.earlyPayoff){
        if(paid!==earlyPayoffQuote(balances)) throw new Error('Early payoff amount mismatch');
        waived=balances.unearned;
      }
      allocation=allocatePayment(paid,balances.principal,balances.interest-waived,balances.fee);
      remaining=balances.principal+balances.interest-waived+balances.fee-paid;
    }
    const p=(await c.query(`INSERT INTO payments(application_id,bank_reference,amount,principal,interest,fee,recovery,verified_by,amount_source,method,status,early_payoff,waived_interest)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [app.id,ref,paid,allocation.principal,allocation.interest,allocation.fee,recovery,actor.id,source,method,status,!!options.earlyPayoff,waived])).rows[0];
    const file=protect(receipt);
    await c.query('INSERT INTO payment_receipts(payment_id,receipt_cipher,receipt_iv,receipt_tag,receipt_mime,receipt_sha256) VALUES($1,$2,$3,$4,$5,$6)',
      [p.id,file.cipher,file.iv,file.tag,mime,file.sha256]);
    if(waived)await journal(c,app.id,'early_payoff_waiver',p.id,[dr(A.unearned,waived),cr(A.interest,waived)]);
    await journal(c,app.id,recovery?'recovery':'payment',p.id,recovery?[dr(debitAccount,paid),cr(A.recoveryIncome,paid)]:
      [dr(debitAccount,paid),cr(A.principal,allocation.principal),cr(A.interest,allocation.interest),cr(A.fee,allocation.fee)]);
    if(!recovery&&remaining===0) await setStatus(c,actor,app,'paid_off');
    if(!recovery&&remaining===0) await closeIfSettled(c,actor,app.id);
    await audit(c,actor,app.id,'payment',null,{paymentId:p.id,amount:paid,amountSource:source,method,status,...allocation,recovery,waived,reference:ref,receiptSha256:file.sha256});
    return {id:app.id,paymentId:p.id as string,amount:paid,amountSource:source,status,allocation,remaining};
  });
}

async function lockedPayment(c:PoolClient,actor:Actor,paymentId:string){
  const row=(await c.query(`SELECT p.*,a.branch_id,a.status AS app_status FROM payments p JOIN applications a ON a.id=p.application_id WHERE p.id=$1 FOR UPDATE OF p`,[paymentId])).rows[0];
  if(!row) throw new Error('Payment not found');
  if(actor.role==='manager'&&row.branch_id!==actor.branch_id) throw new Error('Forbidden');
  if(row.status!=='pending') throw new Error('Payment already reviewed');
  if(row.verified_by===actor.id) throw new Error('Recorder cannot verify own payment');
  return row;
}

export async function verifyPayment(actor:Actor|null,paymentId:string,note=''){
  requireRole(actor,['owner','manager']);
  return transaction(async c=>{
    const row=await lockedPayment(c,actor,paymentId);
    await c.query(`UPDATE payments SET status='verified',reviewed_by=$1,reviewed_at=now(),review_note=$2 WHERE id=$3`,[actor.id,note.trim()||null,paymentId]);
    await closeIfSettled(c,actor,row.application_id);
    await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',[actor.id,'payment',paymentId,'payment_verified',JSON.stringify({applicationId:row.application_id,amount:Number(row.amount)})]);
    return {id:paymentId};
  });
}

// Reversal keeps the ledger append-only; a paid-off loan reopens.
export async function rejectPayment(actor:Actor|null,paymentId:string,note:string){
  requireRole(actor,['owner','manager']);
  if(!note.trim()) throw new Error('Reason required');
  return transaction(async c=>{
    const row=await lockedPayment(c,actor,paymentId);
    if(row.app_status==='closed') throw new Error('Loan already closed');
    const app=await locked(c,row.application_id);
    const debitAccount=row.method==='cash'?A.cashInTransit:A.cash;
    const amount=Number(row.amount);
    await journal(c,app.id,'payment_reversal',paymentId,Number(row.recovery)?[dr(A.recoveryIncome,amount),cr(debitAccount,amount)]:
      [dr(A.principal,Number(row.principal)),dr(A.interest,Number(row.interest)),dr(A.fee,Number(row.fee)),cr(debitAccount,amount)]);
    if(Number(row.waived_interest))await journal(c,app.id,'early_payoff_waiver_reversal',paymentId,[dr(A.interest,Number(row.waived_interest)),cr(A.unearned,Number(row.waived_interest))]);
    await c.query(`UPDATE payments SET status='rejected',reviewed_by=$1,reviewed_at=now(),review_note=$2 WHERE id=$3`,[actor.id,note.trim(),paymentId]);
    if(app.status==='paid_off'){
      await c.query(`UPDATE applications SET status='active' WHERE id=$1`,[app.id]);
      await audit(c,actor,app.id,'active',{status:'paid_off'},{status:'active'},'Pembayaran ditolak saat verifikasi');
    }
    await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data,reason) VALUES($1,$2,$3,$4,$5,$6)',[actor.id,'payment',paymentId,'payment_rejected',JSON.stringify({applicationId:app.id,amount}),note.trim()]);
    return {id:paymentId};
  });
}

export async function readPaymentReceipt(actor:Actor|null,paymentId:string){
  requireRole(actor,['owner','manager','officer']);
  const row=(await pool.query(`SELECT a.branch_id,a.officer_id,a.collector_id,a.customer_id,r.* FROM payment_receipts r JOIN payments p ON p.id=r.payment_id
    JOIN applications a ON a.id=p.application_id WHERE r.payment_id=$1`,[paymentId])).rows[0];
  if(!row) throw new Error('Forbidden');
  try{inScope(actor,row);}catch{throw new Error('Forbidden');}
  await pool.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action) VALUES($1,$2,$3,$4)',[actor.id,'payment',paymentId,'receipt_viewed']);
  return {data:reveal(row.receipt_cipher,row.receipt_iv,row.receipt_tag),mime:row.receipt_mime as string};
}

// Cash an officer collected on a Jakarta calendar day (excluding rejected payments) minus what they already deposited for it.
export async function expectedCash(officerId:string,day:string){
  return Number((await pool.query(`SELECT
      COALESCE((SELECT SUM(amount) FROM payments WHERE verified_by=$1 AND method='cash' AND status<>'rejected' AND (created_at AT TIME ZONE 'Asia/Jakarta')::date=$2),0)
      -COALESCE((SELECT SUM(amount) FROM cash_deposits WHERE officer_id=$1 AND deposit_date=$2 AND status<>'rejected'),0) AS total`,[officerId,day])).rows[0].total);
}

export async function submitDeposit(actor:Actor|null,day:string,amount:number,proof:Uint8Array){
  requireRole(actor,['officer']);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>todayIso()||!Number.isSafeInteger(amount)||amount<0) throw new Error('Invalid deposit');
  const mime=validReceipt(proof);
  return transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`deposit:${actor.id}:${day}`]);
    const expected=await expectedCash(actor.id,day);
    if(expected<=0&&amount>0) throw new Error('Nothing left to deposit');
    const file=protect(proof);
    const row=(await c.query(`INSERT INTO cash_deposits(officer_id,branch_id,deposit_date,amount,expected,proof_cipher,proof_iv,proof_tag,proof_mime,proof_sha256)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[actor.id,actor.branch_id,day,amount,expected,file.cipher,file.iv,file.tag,mime,file.sha256])).rows[0];
    await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',[actor.id,'cash_deposit',row.id,'deposit_submitted',JSON.stringify({day,amount,expected})]);
    return {id:row.id as string,expected,difference:amount-expected};
  });
}

// Confirming moves the deposited amount from cash in transit to cash; any shortfall stays visible in transit.
export async function reviewDeposit(actor:Actor|null,depositId:string,approve:boolean,note=''){
  requireRole(actor,['owner','manager']);
  if(!approve&&!note.trim()) throw new Error('Reason required');
  return transaction(async c=>{
    const row=(await c.query('SELECT * FROM cash_deposits WHERE id=$1 FOR UPDATE',[depositId])).rows[0];
    if(!row) throw new Error('Deposit not found');
    if(actor.role==='manager'&&row.branch_id!==actor.branch_id) throw new Error('Forbidden');
    if(row.status!=='pending') throw new Error('Deposit already reviewed');
    if(approve)await journal(c,null,'cash_deposit',depositId,[dr(A.cash,Number(row.amount)),cr(A.cashInTransit,Number(row.amount))]);
    await c.query('UPDATE cash_deposits SET status=$1,reviewed_by=$2,reviewed_at=now(),review_note=$3 WHERE id=$4',[approve?'confirmed':'rejected',actor.id,note.trim()||null,depositId]);
    await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,reason) VALUES($1,$2,$3,$4,$5)',[actor.id,'cash_deposit',depositId,approve?'deposit_confirmed':'deposit_rejected',note.trim()||null]);
    return {id:depositId};
  });
}

export async function readDepositProof(actor:Actor|null,depositId:string){
  requireRole(actor,['owner','manager','officer']);
  const row=(await pool.query('SELECT * FROM cash_deposits WHERE id=$1',[depositId])).rows[0];
  if(!row||(actor.role==='manager'&&row.branch_id!==actor.branch_id)||(actor.role==='officer'&&row.officer_id!==actor.id)) throw new Error('Forbidden');
  return {data:reveal(row.proof_cipher,row.proof_iv,row.proof_tag),mime:row.proof_mime as string};
}

// Pending officer/auto-read payments and cash deposits awaiting a checker, scoped to the manager's branch.
export async function verificationQueue(actor:Actor){
  requireRole(actor,['owner','manager']);
  const branch=actor.role==='manager'?actor.branch_id:null;
  const [payments,deposits,recent]=await Promise.all([
    pool.query(`SELECT p.id,p.application_id,p.amount,p.method,p.amount_source,p.bank_reference,p.created_at,p.early_payoff,p.verified_by=$2 AS own,
        c.name AS customer_name,u.name AS recorded_by,b.name AS branch_name
      FROM payments p JOIN applications a ON a.id=p.application_id JOIN customers c ON c.id=a.customer_id JOIN users u ON u.id=p.verified_by JOIN branches b ON b.id=a.branch_id
      WHERE p.status='pending' AND ($1::uuid IS NULL OR a.branch_id=$1) ORDER BY p.created_at`,[branch,actor.id]),
    pool.query(`SELECT d.id,to_char(d.deposit_date,'YYYY-MM-DD') AS deposit_date,d.amount,d.expected,d.created_at,u.name AS officer_name,b.name AS branch_name
      FROM cash_deposits d JOIN users u ON u.id=d.officer_id JOIN branches b ON b.id=d.branch_id
      WHERE d.status='pending' AND ($1::uuid IS NULL OR d.branch_id=$1) ORDER BY d.deposit_date`,[branch]),
    pool.query(`SELECT p.id,p.amount,p.status,p.reviewed_at,p.review_note,c.name AS customer_name,r.name AS reviewer
      FROM payments p JOIN applications a ON a.id=p.application_id JOIN customers c ON c.id=a.customer_id JOIN users r ON r.id=p.reviewed_by
      WHERE p.reviewed_at IS NOT NULL AND ($1::uuid IS NULL OR a.branch_id=$1) ORDER BY p.reviewed_at DESC LIMIT 10`,[branch])
  ]);
  return {payments:payments.rows,deposits:deposits.rows,recent:recent.rows};
}

export async function officerDeposits(actor:Actor){
  requireRole(actor,['officer']);
  const today=todayIso();
  const [expectedToday,history]=await Promise.all([expectedCash(actor.id,today),
    pool.query(`SELECT id,to_char(deposit_date,'YYYY-MM-DD') AS deposit_date,amount,expected,status,review_note FROM cash_deposits WHERE officer_id=$1 ORDER BY deposit_date DESC LIMIT 20`,[actor.id])]);
  const undeposited=(await pool.query(`WITH collected AS (SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date AS day,SUM(amount) AS total FROM payments
        WHERE verified_by=$1 AND method='cash' AND status<>'rejected' GROUP BY 1),
      deposited AS (SELECT deposit_date AS day,SUM(amount) AS total FROM cash_deposits WHERE officer_id=$1 AND status<>'rejected' GROUP BY 1)
    SELECT to_char(c.day,'YYYY-MM-DD') AS day,(c.total-COALESCE(d.total,0))::bigint AS total FROM collected c LEFT JOIN deposited d ON d.day=c.day
    WHERE c.total>COALESCE(d.total,0) ORDER BY c.day DESC`,[actor.id])).rows.map(row=>({day:row.day as string,total:Number(row.total)}));
  return {today,expectedToday,history:history.rows,undeposited};
}
