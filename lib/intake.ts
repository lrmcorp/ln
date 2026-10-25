import {createHash,randomUUID} from 'node:crypto';
import {pool,transaction} from './db';
import type {Actor} from './auth';
import {storeIntakeEvidence,type IdentityDetails} from './evidence';
import {imageMime,protect} from './protected-data';
import {jakartaToday} from './finance';
import {monthlyTerms} from './terms';

export type IntakeInput=IdentityDetails&{name:string;phone:string;bankName:string;principal:number;months:number};

function validBirthDate(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().startsWith(value)&&date<jakartaToday();
}

export async function createMonthlyIntake(actor:Actor,input:IntakeInput,ktp:Uint8Array,liveness:Uint8Array){
  if(actor.role!=='officer')throw new Error('Forbidden');
  if(!input.name.trim()||input.name.length>200||!/^[0-9]{16}$/.test(input.nik)||!validBirthDate(input.dateOfBirth)||
    !/^[0-9+ -]{8,20}$/.test(input.phone)||!input.address.trim()||input.address.length>500||
    !input.motherName.trim()||input.motherName.length>200||!input.bankName.trim()||input.bankName.length>100||
    !/^[0-9]{5,30}$/.test(input.bankAccountNumber)||!input.accountHolder.trim()||input.accountHolder.length>200||
    !Number.isSafeInteger(input.principal)||!Number.isSafeInteger(input.months)) throw new Error('Invalid borrower details');
  return transaction(async client=>{
    const policy=(await client.query('SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
    if(!policy)throw new Error('No active policy');
    if(input.principal<Number(policy.min_principal)||input.principal>Number(policy.max_principal)||
      input.months<policy.min_months||input.months>policy.max_months)throw new Error('Outside policy limits');
    const nikHash=createHash('sha256').update(`${process.env.SESSION_SECRET}:${input.nik}`).digest('hex');
    const customer=(await client.query(`INSERT INTO customers(name,nik_hash,nik_last4,phone,bank_name,account_last4,branch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [input.name.trim(),nikHash,input.nik.slice(-4),input.phone.trim(),input.bankName.trim(),input.bankAccountNumber.slice(-4),actor.branch_id])).rows[0];
    const application=(await client.query(`INSERT INTO applications(customer_id,officer_id,branch_id,policy_id,requested_principal,term_months,repayment_frequency,status)
      VALUES($1,$2,$3,$4,$5,$6,'monthly_first','awaiting_signature') RETURNING id`,
      [customer.id,actor.id,actor.branch_id,policy.id,input.principal,input.months])).rows[0];
    const details:IdentityDetails={nik:input.nik,dateOfBirth:input.dateOfBirth,address:input.address.trim(),motherName:input.motherName.trim(),
      bankAccountNumber:input.bankAccountNumber,accountHolder:input.accountHolder.trim(),occupation:input.occupation.trim(),loanPurpose:input.loanPurpose.trim()};
    await storeIntakeEvidence(client,application.id,details,ktp,liveness);
    await client.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',
      [actor.id,'application',application.id,'monthly_intake_created',JSON.stringify({principal:input.principal,months:input.months,policyVersion:policy.version,verificationStatus:'manual_review_required'})]);
    return {id:application.id};
  });
}

async function signingRow(actor:Actor,applicationId:string){
  if(actor.role!=='officer'&&actor.role!=='customer')throw new Error('Forbidden');
  const result=await pool.query(`SELECT a.*,c.name AS customer_name,c.account_last4,p.version AS policy_version,p.flat_interest_bps,p.late_fee_monthly_bps
    FROM applications a JOIN customers c ON c.id=a.customer_id JOIN policy_versions p ON p.id=a.policy_id WHERE a.id=$1`,[applicationId]);
  const row=result.rows[0];
  if(!row||(actor.role==='officer'&&(row.officer_id!==actor.id||row.branch_id!==actor.branch_id))||
    (actor.role==='customer'&&row.customer_id!==actor.customer_id))throw new Error('Forbidden');
  if(row.repayment_frequency!=='monthly_first'||row.status!=='awaiting_signature')throw new Error('Signing is not available');
  return row;
}

export async function signingPreview(actor:Actor,applicationId:string){
  const row=await signingRow(actor,applicationId);
  const quote=monthlyTerms(row.customer_name,Number(row.requested_principal),row.term_months,
    {id:row.policy_id,version:row.policy_version,flat_interest_bps:row.flat_interest_bps,late_fee_monthly_bps:row.late_fee_monthly_bps},
    jakartaToday(),row.account_last4);
  return {applicationId,customerName:row.customer_name,quote};
}

export async function signMonthlyApplication(actor:Actor,applicationId:string,signerName:string,accepted:boolean,termsHash:string,signature:Uint8Array){
  if(process.env.ENABLE_DEMO_ADAPTERS!=='true')throw new Error('A verified signature provider is required');
  if(!accepted)throw new Error('Terms acceptance required');
  if(signature.length<250||signature.length>500000||imageMime(signature)!=='image/png')throw new Error('Invalid signature image');
  return transaction(async client=>{
    if(actor.role!=='officer'&&actor.role!=='customer')throw new Error('Forbidden');
    const result=await client.query(`SELECT a.*,c.name AS customer_name,c.account_last4,p.version AS policy_version,p.flat_interest_bps,p.late_fee_monthly_bps
      FROM applications a JOIN customers c ON c.id=a.customer_id JOIN policy_versions p ON p.id=a.policy_id WHERE a.id=$1 FOR UPDATE OF a`,[applicationId]);
    const row=result.rows[0];
    if(!row||(actor.role==='officer'&&(row.officer_id!==actor.id||row.branch_id!==actor.branch_id))||
      (actor.role==='customer'&&row.customer_id!==actor.customer_id))throw new Error('Forbidden');
    if(row.status!=='awaiting_signature'||row.repayment_frequency!=='monthly_first')throw new Error('Signing is not available');
    if(signerName.trim().toLocaleLowerCase('id-ID')!==row.customer_name.trim().toLocaleLowerCase('id-ID'))throw new Error('Signer name does not match borrower');
    const quote=monthlyTerms(row.customer_name,Number(row.requested_principal),row.term_months,
      {id:row.policy_id,version:row.policy_version,flat_interest_bps:row.flat_interest_bps,late_fee_monthly_bps:row.late_fee_monthly_bps},
      jakartaToday(),row.account_last4);
    if(quote.hash!==termsHash)throw new Error('Terms changed; review again');
    const agreement=(await client.query(`INSERT INTO agreements(application_id,version,snapshot,snapshot_hash,signed_at,signed_by,signature_receipt)
      VALUES($1,1,$2,$3,now(),$4,$5) RETURNING id`,
      [applicationId,JSON.stringify(quote.snapshot),quote.hash,actor.role==='customer'?actor.id:null,`demo-signature:${randomUUID()}`])).rows[0];
    const protectedSignature=protect(signature);
    await client.query(`INSERT INTO signature_evidence(agreement_id,signature_cipher,signature_iv,signature_tag,signature_sha256,signer_name,signing_method,witness_officer_id,terms_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [agreement.id,protectedSignature.cipher,protectedSignature.iv,protectedSignature.tag,protectedSignature.sha256,
        row.customer_name,actor.role==='officer'?'officer_device_demo':'customer_session_demo',actor.role==='officer'?actor.id:null,quote.hash]);
    for(const item of quote.snapshot.schedule)await client.query('INSERT INTO installments(application_id,sequence,due_at,principal,interest) VALUES($1,$2,$3,$4,$5)',
      [applicationId,item.sequence,item.dueAt,item.principal,item.interest]);
    await client.query('UPDATE applications SET status=$1 WHERE id=$2',['signed_pending_approval',applicationId]);
    await client.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',
      [actor.id,'application',applicationId,'signed_pending_approval',JSON.stringify({agreementHash:quote.hash,method:actor.role==='officer'?'officer_device_demo':'customer_session_demo'})]);
    return {id:applicationId,hash:quote.hash};
  });
}
