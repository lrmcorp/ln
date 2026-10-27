import {createHash, randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {pool,transaction} from './db';
import type {Actor} from './auth';
import {requireRole} from './auth';
import {allocatePayment, assertBalanced, calculateFlatSchedule, canonicalJson, jakartaToday} from './finance';
import {imageMime,protect,reveal} from './protected-data';
import {normalizeWeeklyRates} from './terms';

type Action =
 | {type:'policy';minPrincipal:number;maxPrincipal:number;flatInterestBps?:number;minWeeks?:number;maxWeeks?:number;minMonths?:number;maxMonths?:number;lateFeeMonthlyBps?:number;weeklyRates?:{weeks:number;rateBps:number}[]}
 | {type:'customer';name:string;nik:string;phone:string;bankName:string;accountNumber:string}
 | {type:'create';customerId:string;principal:number;weeks:number}
 | {type:'approve';applicationId:string;reason?:string}
 | {type:'review_evidence';applicationId:string;reason:string}
 | {type:'sign';applicationId:string}
 | {type:'authorize';applicationId:string}
 | {type:'initiate';applicationId:string;idempotencyKey:string}
 | {type:'confirm';applicationId:string;bankReference:string;proof:string}
 | {type:'close';applicationId:string};

async function audit(c:PoolClient,actor:Actor,appId:string,action:string,before:unknown,after:unknown,reason?:string){
  await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,before_data,after_data,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [actor.id,'application',appId,action,JSON.stringify(before),JSON.stringify(after),reason??null]);
}

async function locked(c:PoolClient,id:string){
  const result=await c.query('SELECT * FROM applications WHERE id=$1 FOR UPDATE',[id]);
  if(!result.rows[0]) throw new Error('Application not found');
  return result.rows[0];
}

async function setStatus(c:PoolClient,actor:Actor,app:Record<string,unknown>,status:string,reason?:string){
  await c.query('UPDATE applications SET status=$1 WHERE id=$2',[status,app.id]);
  if(status==='paid_off'||status==='closed'){
    await c.query(`UPDATE location_shares SET enabled=false,stopped_at=now(),latitude=NULL,longitude=NULL,accuracy_m=NULL,reported_at=NULL,updated_at=now()
      WHERE customer_id=$1 AND enabled=true AND NOT EXISTS(SELECT 1 FROM applications WHERE customer_id=$1 AND status='active')`,[app.customer_id]);
    await c.query(`UPDATE mobile_devices SET revoked_at=now(),sharing_enabled=false
      WHERE customer_id=$1 AND revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM applications WHERE customer_id=$1 AND status='active')`,[app.customer_id]);
  }
  await audit(c,actor,String(app.id),status,{status:app.status},{status},reason);
}

function inScope(actor:Actor,app:Record<string,any>){
  if(actor.role==='officer' && (app.officer_id!==actor.id || app.branch_id!==actor.branch_id)) throw new Error('Unassigned application');
  if(actor.role==='customer' && app.customer_id!==actor.customer_id) throw new Error('Unrelated application');
  if(actor.role==='manager' && app.branch_id!==actor.branch_id) throw new Error('Forbidden');
}

async function journal(c:PoolClient,appId:string,type:string,sourceId:string,lines:{account:string;debit:number;credit:number}[]){
  assertBalanced(lines);
  const j=await c.query('INSERT INTO journals(application_id,event_type,source_id) VALUES($1,$2,$3) RETURNING id',[appId,type,sourceId]);
  for(const line of lines) await c.query('INSERT INTO journal_lines(journal_id,account,debit,credit) VALUES($1,$2,$3,$4)',[j.rows[0].id,line.account,line.debit,line.credit]);
}

export async function perform(actor:Actor|null, action:Action){
  if(!actor) throw new Error('Forbidden');
  return transaction(async c=>{
    if(action.type==='policy'){
      requireRole(actor,['owner']);
      await c.query('SELECT pg_advisory_xact_lock(710102)');
      const previous=(await c.query('SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
      const minMonths=action.minMonths??previous?.min_months??1;
      const maxMonths=action.maxMonths??previous?.max_months??12;
      const lateFeeMonthlyBps=action.lateFeeMonthlyBps??previous?.late_fee_monthly_bps??500;
      const weeklyRates=normalizeWeeklyRates(action.weeklyRates??previous?.weekly_rates??[{weeks:4,rateBps:2000},{weeks:5,rateBps:2500},{weeks:6,rateBps:3000}]);
      const flatInterestBps=action.flatInterestBps??previous?.flat_interest_bps??0;
      const minWeeks=action.minWeeks??weeklyRates[0].weeks,maxWeeks=action.maxWeeks??weeklyRates[weeklyRates.length-1].weeks;
      if(![action.minPrincipal,action.maxPrincipal,flatInterestBps,minWeeks,maxWeeks,minMonths,maxMonths,lateFeeMonthlyBps].every(Number.isSafeInteger)||
        action.minPrincipal<=0||action.maxPrincipal<action.minPrincipal||action.maxPrincipal>1000000000||
        flatInterestBps<0||flatInterestBps>10000||minWeeks<1||maxWeeks<minWeeks||maxWeeks>260||
        minMonths<1||maxMonths<minMonths||maxMonths>60||lateFeeMonthlyBps<0||lateFeeMonthlyBps>10000) throw new Error('Invalid policy limits');
      const version=Number(previous?.version??0)+1;
      const result=await c.query('INSERT INTO policy_versions(version,min_principal,max_principal,flat_interest_bps,min_weeks,max_weeks,min_months,max_months,late_fee_monthly_bps,weekly_rates,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
        [version,action.minPrincipal,action.maxPrincipal,flatInterestBps,minWeeks,maxWeeks,minMonths,maxMonths,lateFeeMonthlyBps,JSON.stringify(weeklyRates),actor.id]);
      await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',
        [actor.id,'policy',result.rows[0].id,'version_created',JSON.stringify(previous??null),JSON.stringify({...action,minMonths,maxMonths,lateFeeMonthlyBps,weeklyRates,version})]);
      return {id:result.rows[0].id,version};
    }
    if(action.type==='customer'){
      requireRole(actor,['officer']);
      if(!action.name.trim()||!/^[0-9]{16}$/.test(action.nik)||!/^[0-9+ -]{8,20}$/.test(action.phone)||
        !action.bankName.trim()||!/^[0-9]{5,30}$/.test(action.accountNumber)) throw new Error('Invalid borrower details');
      const nikHash=createHash('sha256').update(`${process.env.SESSION_SECRET}:${action.nik}`).digest('hex');
      const result=await c.query('INSERT INTO customers(name,nik_hash,nik_last4,phone,bank_name,account_last4,branch_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [action.name.trim(),nikHash,action.nik.slice(-4),action.phone.trim(),action.bankName.trim(),action.accountNumber.slice(-4),actor.branch_id]);
      await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',
        [actor.id,'customer',result.rows[0].id,'created',JSON.stringify({name:action.name.trim(),nikLast4:action.nik.slice(-4)})]);
      return {id:result.rows[0].id};
    }
    if(action.type==='create'){
      requireRole(actor,['officer']);
      const customer=await c.query('SELECT id,branch_id FROM customers WHERE id=$1',[action.customerId]);
      if(!customer.rows[0] || customer.rows[0].branch_id!==actor.branch_id) throw new Error('Customer outside assigned branch');
      const policy=(await c.query('SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
      if(!policy) throw new Error('No active policy');
      if(!Number.isSafeInteger(action.principal)||action.principal<Number(policy.min_principal)||action.principal>Number(policy.max_principal)||
         !Number.isSafeInteger(action.weeks)||action.weeks<policy.min_weeks||action.weeks>policy.max_weeks) throw new Error('Outside policy limits');
      const result=await c.query('INSERT INTO applications(customer_id,officer_id,branch_id,requested_principal,term_weeks) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [action.customerId,actor.id,actor.branch_id,action.principal,action.weeks]);
      await audit(c,actor,result.rows[0].id,'submitted',null,{principal:action.principal,weeks:action.weeks});
      return {id:result.rows[0].id};
    }
    const app=await locked(c,action.applicationId);
    inScope(actor,app);
    switch(action.type){
      case 'review_evidence': {
        requireRole(actor,['owner']);
        if(!['awaiting_signature','signed_pending_approval'].includes(app.status)||!action.reason.trim())throw new Error('Identity review not allowed');
        const evidence=await c.query(`UPDATE intake_evidence SET verification_status='manual_review_completed'
          WHERE application_id=$1 RETURNING application_id`,[app.id]);
        if(!evidence.rows[0])throw new Error('Identity evidence missing');
        await audit(c,actor,app.id,'identity_manual_review_completed',null,{status:'manual_review_completed'},action.reason.trim());
        return {id:app.id};
      }
      case 'approve': {
        requireRole(actor,['owner']);
        if(app.status==='signed_pending_approval'){
          const reviewed=(await c.query('SELECT verification_status FROM intake_evidence WHERE application_id=$1',[app.id])).rows[0];
          if(reviewed?.verification_status!=='manual_review_completed')throw new Error('Identity review required');
          const agreement=(await c.query('SELECT * FROM agreements WHERE application_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE',[app.id])).rows[0];
          const signature=agreement?(await c.query('SELECT agreement_id FROM signature_evidence WHERE agreement_id=$1',[agreement.id])).rows[0]:null;
          if(!agreement?.signed_at||!signature||createHash('sha256').update(canonicalJson(agreement.snapshot)).digest('hex')!==agreement.snapshot_hash||
            Number(agreement.snapshot.principal)!==Number(app.requested_principal)||agreement.snapshot.policyId!==app.policy_id)throw new Error('Signed terms mismatch');
          if(app.repayment_frequency==='weekly_from_approval'){
            const weekly=calculateFlatSchedule(Number(agreement.snapshot.principal),Number(agreement.snapshot.rateBps),Number(agreement.snapshot.weeks),jakartaToday());
            const signedAmounts=canonicalJson(agreement.snapshot.schedule);
            if(weekly.interest!==Number(agreement.snapshot.interest)||canonicalJson(weekly.installments.map(({sequence,principal,interest})=>({sequence,principal,interest})))!==signedAmounts)throw new Error('Signed terms mismatch');
            for(const item of weekly.installments) await c.query('INSERT INTO installments(application_id,sequence,due_at,principal,interest) VALUES($1,$2,$3,$4,$5)',
              [app.id,item.sequence,item.dueAt,item.principal,item.interest]);
          }
          await c.query('UPDATE applications SET status=$1,approved_principal=$2,interest_amount=$3,approved_at=now() WHERE id=$4',
            ['signed',agreement.snapshot.principal,agreement.snapshot.interest,app.id]);
          await audit(c,actor,app.id,'signed_terms_approved',{status:app.status},{status:'signed',snapshotHash:agreement.snapshot_hash},action.reason);
          return {id:app.id,hash:agreement.snapshot_hash};
        }
        if(app.status!=='submitted'||app.officer_id===actor.id) throw new Error('Approval not allowed');
        const policy=(await c.query('SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
        const principal=Number(app.requested_principal);
        const calculation=calculateFlatSchedule(principal,policy.flat_interest_bps,app.term_weeks,jakartaToday());
        const snapshot={principal,interest:calculation.interest,total:calculation.total,weeks:app.term_weeks,
          rateBps:policy.flat_interest_bps,policyVersion:policy.version,schedule:calculation.installments};
        const hash=createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
        await c.query('UPDATE applications SET status=$1,approved_principal=$2,interest_amount=$3,policy_id=$4,approved_at=now() WHERE id=$5',
          ['approved',principal,calculation.interest,policy.id,app.id]);
        await c.query('INSERT INTO agreements(application_id,version,snapshot,snapshot_hash) VALUES($1,1,$2,$3)',[app.id,JSON.stringify(snapshot),hash]);
        for(const item of calculation.installments) await c.query('INSERT INTO installments(application_id,sequence,due_at,principal,interest) VALUES($1,$2,$3,$4,$5)',
          [app.id,item.sequence,item.dueAt,item.principal,item.interest]);
        await audit(c,actor,app.id,'approved',{status:app.status},{status:'approved',snapshotHash:hash},action.reason);
        return {id:app.id,hash};
      }
      case 'sign': {
        requireRole(actor,['customer']);
        if(app.status!=='approved') throw new Error('Agreement is not available for signing');
        if(process.env.ENABLE_DEMO_ADAPTERS!=='true') throw new Error('A verified signature provider is required');
        const agreement=(await c.query('SELECT * FROM agreements WHERE application_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE',[app.id])).rows[0];
        const hash=createHash('sha256').update(canonicalJson(agreement.snapshot)).digest('hex');
        if(hash!==agreement.snapshot_hash) throw new Error('Agreement hash mismatch');
        const receipt=`demo-signature:${randomUUID()}`;
        await c.query('UPDATE agreements SET signed_at=now(),signed_by=$1,signature_receipt=$2 WHERE id=$3',[actor.id,receipt,agreement.id]);
        await setStatus(c,actor,app,'signed','Demo adapter; not a production electronic signature');
        return {id:app.id,receipt};
      }
      case 'authorize': {
        requireRole(actor,['owner']);
        if(app.status!=='signed') throw new Error('Signed agreement required');
        const agreement=(await c.query('SELECT * FROM agreements WHERE application_id=$1 ORDER BY version DESC LIMIT 1',[app.id])).rows[0];
        if(!agreement?.signed_at) throw new Error('Signed agreement required');
        await setStatus(c,actor,app,'release_authorized');
        return {id:app.id};
      }
      case 'initiate': {
        requireRole(actor,['owner']);
        if(app.status==='transfer_initiated') {
          const existing=(await c.query('SELECT idempotency_key FROM disbursements WHERE application_id=$1',[app.id])).rows[0];
          if(existing?.idempotency_key===action.idempotencyKey) return {id:app.id,replayed:true};
        }
        if(app.status!=='release_authorized') throw new Error('Release authorization required');
        if(!action.idempotencyKey||action.idempotencyKey.length>100) throw new Error('Invalid idempotency key');
        await c.query('INSERT INTO disbursements(application_id,idempotency_key,authorized_by) VALUES($1,$2,$3)',[app.id,action.idempotencyKey,actor.id]);
        await setStatus(c,actor,app,'transfer_initiated');
        return {id:app.id};
      }
      case 'confirm': {
        requireRole(actor,['owner']);
        if(app.status!=='transfer_initiated') throw new Error('Transfer not initiated');
        if(!/^\d+$/.test(action.bankReference) || !action.proof.trim()) throw new Error('Numeric bank reference and independent settlement proof required');
        if(process.env.ENABLE_DEMO_ADAPTERS!=='true') throw new Error('A verified bank reconciliation adapter is required');
        const d=(await c.query('SELECT id FROM disbursements WHERE application_id=$1 FOR UPDATE',[app.id])).rows[0];
        await c.query('UPDATE disbursements SET bank_reference=$1,proof=$2,confirmed_by=$3,confirmed_at=now() WHERE id=$4',
          [action.bankReference,action.proof,actor.id,d.id]);
        const principal=Number(app.approved_principal),interest=Number(app.interest_amount);
        await journal(c,app.id,'disbursement',d.id,[
          {account:'principal_receivable',debit:principal,credit:0},{account:'interest_receivable',debit:interest,credit:0},
          {account:'cash',debit:0,credit:principal},{account:'interest_income',debit:0,credit:interest}
        ]);
        await setStatus(c,actor,app,'active');
        return {id:app.id};
      }
      case 'close': {
        requireRole(actor,['owner']);
        if(app.status!=='paid_off') throw new Error('Ledger obligations must be paid off');
        await setStatus(c,actor,app,'closed');
        return {id:app.id};
      }
    }
  });
}

const maxReceiptBytes=5*1024*1024;
export function receiptMime(data:Uint8Array){
  if(data.length>=5&&Buffer.from(data.subarray(0,5)).toString('ascii')==='%PDF-')return 'application/pdf';
  return imageMime(data);
}

// Every repayment needs the uploaded receipt; the reference number is optional because many receipts lack one.
export async function recordPayment(actor:Actor|null,applicationId:string,amount:number,reference:string|null,receipt:Uint8Array){
  requireRole(actor,['owner','manager']);
  if(!Number.isSafeInteger(amount)||amount<=0||(reference!==null&&(!reference.trim()||reference.length>100))) throw new Error('Invalid payment');
  if(receipt.length<12||receipt.length>maxReceiptBytes) throw new Error('Invalid receipt');
  const mime=receiptMime(receipt);
  if(!mime) throw new Error('Invalid receipt');
  return transaction(async c=>{
    const app=await locked(c,applicationId);
    inScope(actor,app);
    if(app.status!=='active') throw new Error('Loan is not active');
    const balances=await c.query(`SELECT l.account,COALESCE(SUM(l.debit-l.credit),0)::bigint AS balance
      FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.application_id=$1
      AND l.account IN ('principal_receivable','interest_receivable') GROUP BY l.account`,[app.id]);
    const principal=Number(balances.rows.find(r=>r.account==='principal_receivable')?.balance??0);
    const interest=Number(balances.rows.find(r=>r.account==='interest_receivable')?.balance??0);
    const allocation=allocatePayment(amount,principal,interest);
    const ref=reference?.trim()||null;
    const p=await c.query('INSERT INTO payments(application_id,bank_reference,amount,principal,interest,verified_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [app.id,ref,amount,allocation.principal,allocation.interest,actor.id]);
    const file=protect(receipt);
    await c.query('INSERT INTO payment_receipts(payment_id,receipt_cipher,receipt_iv,receipt_tag,receipt_mime,receipt_sha256) VALUES($1,$2,$3,$4,$5,$6)',
      [p.rows[0].id,file.cipher,file.iv,file.tag,mime,file.sha256]);
    await journal(c,app.id,'payment',p.rows[0].id,[
      {account:'cash',debit:amount,credit:0},
      {account:'principal_receivable',debit:0,credit:allocation.principal},
      {account:'interest_receivable',debit:0,credit:allocation.interest}
    ]);
    if(amount===principal+interest) await setStatus(c,actor,app,'paid_off');
    await audit(c,actor,app.id,'payment',null,{paymentId:p.rows[0].id,amount,...allocation,reference:ref,receiptSha256:file.sha256});
    return {id:app.id,paymentId:p.rows[0].id,allocation,remaining:principal+interest-amount};
  });
}

export async function readPaymentReceipt(actor:Actor|null,paymentId:string){
  requireRole(actor,['owner','manager']);
  const row=(await pool.query(`SELECT a.branch_id,r.* FROM payment_receipts r JOIN payments p ON p.id=r.payment_id
    JOIN applications a ON a.id=p.application_id WHERE r.payment_id=$1`,[paymentId])).rows[0];
  if(!row||(actor.role==='manager'&&row.branch_id!==actor.branch_id)) throw new Error('Forbidden');
  await pool.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action) VALUES($1,$2,$3,$4)',[actor.id,'payment',paymentId,'receipt_viewed']);
  return {data:reveal(row.receipt_cipher,row.receipt_iv,row.receipt_tag),mime:row.receipt_mime as string};
}
