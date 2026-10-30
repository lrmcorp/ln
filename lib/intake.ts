import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {pool,transaction} from './db';
import type {Actor} from './auth';
import {storeIntakeEvidence,type IdentityDetails} from './evidence';
import {imageMime,protect} from './protected-data';
import {calculateFlatSchedule,jakartaToday} from './finance';
import {monthlyTerms,weeklyRate,weeklyTerms} from './terms';
import {applyRestructure,pendingRestructure,restructureTerms} from './accounting';
import {borrowerGrade,gradeColumns} from './grade';
import {assertExposure} from './exposure';

export type IntakeInput=IdentityDetails&{name:string;phone:string;bankName:string;principal:number;weeks:number;weeklyIncome:number;collectorId?:string|null};

const nikHashOf=(nik:string)=>createHash('sha256').update(`${process.env.SESSION_SECRET}:${nik}`).digest('hex');
const sameName=(a:string,b:string)=>a.trim().toLocaleLowerCase('id-ID')===b.trim().toLocaleLowerCase('id-ID');

type Queryable={query:PoolClient['query']};

// Graduated limits: a first loan is capped low; each on-time payoff raises the next limit by the policy growth rate.
export async function borrowingLimit(db:Queryable,customerId:string|null,policy:Record<string,any>){
  const max=Number(policy.max_principal),first=Math.min(max,Number(policy.first_loan_max));
  if(!customerId)return {limit:first,repeat:false,reason:'Pinjaman pertama'};
  // The grade over every disbursed loan sets the limit: A grows, B keeps the last amount, C restarts at the first-loan cap, D cannot borrow.
  const history=(await db.query(`SELECT ${gradeColumns} FROM customers c WHERE c.id=$1`,[customerId])).rows[0];
  const {grade,label}=borrowerGrade({loans:history.grade_loans,worstDpd:history.grade_worst_dpd,writtenOff:history.grade_written_off});
  const last=(await db.query(`SELECT approved_principal FROM applications WHERE customer_id=$1 AND status IN ('paid_off','closed') ORDER BY approved_at DESC NULLS LAST LIMIT 1`,[customerId])).rows[0];
  if(grade==='D')return {limit:0,repeat:true,reason:`Kelas D: ${label.toLowerCase()}`};
  if(!last)return {limit:first,repeat:true,reason:'Belum ada pinjaman selesai'};
  const previous=Number(last.approved_principal);
  if(grade==='A')return {limit:Math.min(max,Math.max(first,Math.round(previous*(10000+Number(policy.repeat_growth_bps))/10000))),repeat:true,reason:'Kelas A: lunas tepat waktu, batas naik'};
  if(grade==='B')return {limit:Math.min(max,Math.max(first,previous)),repeat:true,reason:`Kelas B: ${label.toLowerCase()}, batas tetap`};
  return {limit:first,repeat:true,reason:`Kelas C: ${label.toLowerCase()}, batas kembali ke pinjaman pertama`};
}

// Lets the officer see a returning borrower's limit before choosing the amount.
export async function borrowerLookup(actor:Actor,nik:string,name:string){
  if(actor.role!=='officer'&&actor.role!=='manager')throw new Error('Forbidden');
  if(!/^[0-9]{16}$/.test(nik))throw new Error('Invalid borrower details');
  const policy=(await pool.query('SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
  if(!policy)throw new Error('No active policy');
  const customer=(await pool.query('SELECT id,name,branch_id FROM customers WHERE nik_hash=$1',[nikHashOf(nik)])).rows[0];
  if(customer)await assertRepeatAllowed(pool,customer,actor,name);
  const result=await borrowingLimit(pool,customer?.id??null,policy);
  const history=customer?(await pool.query(`SELECT ${gradeColumns} FROM customers c WHERE c.id=$1`,[customer.id])).rows[0]:null;
  const grade=borrowerGrade({loans:history?.grade_loans??0,worstDpd:history?.grade_worst_dpd??0,writtenOff:!!history?.grade_written_off});
  return {...result,grade:grade.grade,gradeLabel:grade.label,maxInstallmentShareBps:Number(policy.max_installment_income_bps)};
}

async function assertRepeatAllowed(db:Queryable,customer:Record<string,any>,actor:Actor,name:string){
  if(customer.branch_id!==actor.branch_id)throw new Error('Customer registered in another branch');
  if(name&&!sameName(customer.name,name))throw new Error('Name does not match registered NIK');
  const open=(await db.query(`SELECT 1 FROM applications WHERE customer_id=$1 AND status NOT IN ('paid_off','closed','rejected','written_off') LIMIT 1`,[customer.id])).rows[0];
  if(open)throw new Error('Customer has an open loan');
}

function validBirthDate(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().startsWith(value)&&date<jakartaToday();
}

export async function createIntake(actor:Actor,input:IntakeInput,ktp:Uint8Array,liveness:Uint8Array){
  // Officers collect what they originate; a branch manager originates for an officer of the branch, who then collects it.
  if(actor.role!=='officer'&&actor.role!=='manager')throw new Error('Forbidden');
  if(!input.name.trim()||input.name.length>200||!/^[0-9]{16}$/.test(input.nik)||!validBirthDate(input.dateOfBirth)||
    !/^[0-9+ -]{8,20}$/.test(input.phone)||!input.address.trim()||input.address.length>500||
    !input.motherName.trim()||input.motherName.length>200||!input.bankName.trim()||input.bankName.length>100||
    !/^[0-9]{5,30}$/.test(input.bankAccountNumber)||!input.accountHolder.trim()||input.accountHolder.length>200||
    !Number.isSafeInteger(input.principal)||!Number.isSafeInteger(input.weeks)||!Number.isSafeInteger(input.weeklyIncome)||input.weeklyIncome<=0) throw new Error('Invalid borrower details');
  return transaction(async client=>{
    const policy=(await client.query('SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
    if(!policy)throw new Error('No active policy');
    if(input.principal<Number(policy.min_principal)||input.principal>Number(policy.max_principal))throw new Error('Outside policy limits');
    const rateBps=weeklyRate(policy.weekly_rates,input.weeks);
    const nikHash=nikHashOf(input.nik);
    const existing=(await client.query('SELECT id,name,branch_id FROM customers WHERE nik_hash=$1 FOR UPDATE',[nikHash])).rows[0];
    if(existing)await assertRepeatAllowed(client,existing,actor,input.name);
    const {limit}=await borrowingLimit(client,existing?.id??null,policy);
    if(input.principal>limit)throw new Error('Above borrowing limit');
    // The largest weekly installment must fit within the policy share of weekly income.
    const largest=calculateFlatSchedule(input.principal,rateBps,input.weeks,new Date(0)).installments.reduce((max,item)=>Math.max(max,item.principal+item.interest),0);
    if(largest*10000>input.weeklyIncome*Number(policy.max_installment_income_bps))throw new Error('Installment exceeds income share');
    await client.query('SELECT pg_advisory_xact_lock(710103)');
    const collectorId=actor.role==='officer'?actor.id:input.collectorId??'';
    if(actor.role==='manager'&&!(await client.query(`SELECT 1 FROM users WHERE id::text=$1 AND role='officer' AND active AND branch_id=$2`,[collectorId,actor.branch_id])).rows[0])throw new Error('Collector required');
    await assertExposure(client,policy,{collectorId,branchId:actor.branch_id!,principal:input.principal});
    const customer=existing?(await client.query(`UPDATE customers SET phone=$1,bank_name=$2,account_last4=$3,weekly_income=$4 WHERE id=$5 RETURNING id`,
        [input.phone.trim(),input.bankName.trim(),input.bankAccountNumber.slice(-4),input.weeklyIncome,existing.id])).rows[0]
      :(await client.query(`INSERT INTO customers(name,nik_hash,nik_last4,phone,bank_name,account_last4,branch_id,weekly_income)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [input.name.trim(),nikHash,input.nik.slice(-4),input.phone.trim(),input.bankName.trim(),input.bankAccountNumber.slice(-4),actor.branch_id,input.weeklyIncome])).rows[0];
    const application=(await client.query(`INSERT INTO applications(customer_id,officer_id,collector_id,branch_id,policy_id,requested_principal,term_weeks,repayment_frequency,status,weekly_income)
      VALUES($1,$2,$8,$3,$4,$5,$6,'weekly_from_approval','awaiting_signature',$7) RETURNING id`,
      [customer.id,actor.id,actor.branch_id,policy.id,input.principal,input.weeks,input.weeklyIncome,collectorId])).rows[0];
    const details:IdentityDetails={nik:input.nik,dateOfBirth:input.dateOfBirth,address:input.address.trim(),motherName:input.motherName.trim(),
      bankAccountNumber:input.bankAccountNumber,accountHolder:input.accountHolder.trim(),occupation:input.occupation.trim(),loanPurpose:input.loanPurpose.trim()};
    await storeIntakeEvidence(client,application.id,details,ktp,liveness);
    await client.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',
      [actor.id,'application',application.id,'weekly_intake_created',JSON.stringify({principal:input.principal,weeks:input.weeks,repeatBorrower:!!existing,limit,weeklyIncome:input.weeklyIncome,policyVersion:policy.version,verificationStatus:'manual_review_required'})]);
    return {id:application.id};
  });
}

async function signingRow(actor:Actor,applicationId:string){
  if(!['officer','manager','customer'].includes(actor.role))throw new Error('Forbidden');
  const result=await pool.query(`SELECT a.*,c.name AS customer_name,c.account_last4,p.version AS policy_version,p.flat_interest_bps,p.late_fee_monthly_bps,p.weekly_rates
    FROM applications a JOIN customers c ON c.id=a.customer_id JOIN policy_versions p ON p.id=a.policy_id WHERE a.id=$1`,[applicationId]);
  const row=result.rows[0];
  if(!row||!mayHandOver(actor,row))throw new Error('Forbidden');
  if(row.status==='active'){
    const restructure=(await pool.query(`SELECT * FROM agreements WHERE application_id=$1 AND kind='restructure' AND signed_at IS NULL ORDER BY version DESC LIMIT 1`,[applicationId])).rows[0];
    if(restructure)return {...row,restructure};
  }
  if(!['monthly_first','weekly_from_approval'].includes(row.repayment_frequency)||row.status!=='awaiting_signature')throw new Error('Signing is not available');
  return row;
}

// The originating officer or manager, the assigned collector, or the borrower may present terms.
function mayHandOver(actor:Actor,row:Record<string,any>){
  if(actor.role==='customer')return row.customer_id===actor.customer_id;
  return row.branch_id===actor.branch_id&&(row.officer_id===actor.id||row.collector_id===actor.id);
}

// Older monthly applications keep their original terms; new intake is weekly from the approval date.
function quoteFor(row:Record<string,any>){
  if(row.restructure){
    const snapshot=row.restructure.snapshot as ReturnType<typeof restructureTerms>['snapshot'];
    return {snapshot,hash:row.restructure.snapshot_hash as string,terms:snapshot.terms};
  }
  const policy={id:row.policy_id,version:row.policy_version,flat_interest_bps:row.flat_interest_bps,late_fee_monthly_bps:row.late_fee_monthly_bps,weekly_rates:row.weekly_rates};
  return row.repayment_frequency==='weekly_from_approval'
    ?weeklyTerms(row.customer_name,Number(row.requested_principal),row.term_weeks,policy,row.account_last4)
    :monthlyTerms(row.customer_name,Number(row.requested_principal),row.term_months,policy,jakartaToday(),row.account_last4);
}

export async function signingPreview(actor:Actor,applicationId:string){
  const row=await signingRow(actor,applicationId);
  return {applicationId,customerName:row.customer_name,quote:quoteFor(row)};
}

export async function signApplication(actor:Actor,applicationId:string,signerName:string,accepted:boolean,termsHash:string,signature:Uint8Array){
  if(process.env.ENABLE_DEMO_ADAPTERS!=='true')throw new Error('A verified signature provider is required');
  if(!accepted)throw new Error('Terms acceptance required');
  if(signature.length<250||signature.length>500000||imageMime(signature)!=='image/png')throw new Error('Invalid signature image');
  return transaction(async client=>{
    if(!['officer','manager','customer'].includes(actor.role))throw new Error('Forbidden');
    const result=await client.query(`SELECT a.*,c.name AS customer_name,c.account_last4,p.version AS policy_version,p.flat_interest_bps,p.late_fee_monthly_bps,p.weekly_rates
      FROM applications a JOIN customers c ON c.id=a.customer_id JOIN policy_versions p ON p.id=a.policy_id WHERE a.id=$1 FOR UPDATE OF a`,[applicationId]);
    const row=result.rows[0];
    if(!row||!mayHandOver(actor,row))throw new Error('Forbidden');
    if(signerName.trim().toLocaleLowerCase('id-ID')!==row.customer_name.trim().toLocaleLowerCase('id-ID'))throw new Error('Signer name does not match borrower');
    const restructure=row.status==='active'?await pendingRestructure(client,applicationId):null;
    if(restructure){
      if(restructure.snapshot_hash!==termsHash)throw new Error('Terms changed; review again');
      await applyRestructure(client,row,restructure,actor.role==='customer'?actor.id:null);
      await storeSignature(client,restructure.id,signature,row.customer_name,actor,termsHash);
      await client.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',
        [actor.id,'application',applicationId,'restructure_signed',JSON.stringify({agreementHash:termsHash})]);
      return {id:applicationId,hash:termsHash};
    }
    if(row.status!=='awaiting_signature'||!['monthly_first','weekly_from_approval'].includes(row.repayment_frequency))throw new Error('Signing is not available');
    const quote=quoteFor(row);
    if(quote.hash!==termsHash)throw new Error('Terms changed; review again');
    const agreement=(await client.query(`INSERT INTO agreements(application_id,version,snapshot,snapshot_hash,signed_at,signed_by,signature_receipt)
      VALUES($1,1,$2,$3,now(),$4,$5) RETURNING id`,
      [applicationId,JSON.stringify(quote.snapshot),quote.hash,actor.role==='customer'?actor.id:null,`demo-signature:${randomUUID()}`])).rows[0];
    await storeSignature(client,agreement.id,signature,row.customer_name,actor,quote.hash);
    // Weekly due dates are created at owner approval.
    if('months' in quote.snapshot)for(const item of quote.snapshot.schedule)await client.query('INSERT INTO installments(application_id,sequence,due_at,principal,interest) VALUES($1,$2,$3,$4,$5)',
      [applicationId,item.sequence,item.dueAt,item.principal,item.interest]);
    await client.query('UPDATE applications SET status=$1 WHERE id=$2',['signed_pending_approval',applicationId]);
    await client.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',
      [actor.id,'application',applicationId,'signed_pending_approval',JSON.stringify({agreementHash:quote.hash,method:actor.role!=='customer'?'officer_device_demo':'customer_session_demo'})]);
    return {id:applicationId,hash:quote.hash};
  });
}

async function storeSignature(client:PoolClient,agreementId:string,signature:Uint8Array,signerName:string,actor:Actor,hash:string){
  const protectedSignature=protect(signature);
  await client.query(`INSERT INTO signature_evidence(agreement_id,signature_cipher,signature_iv,signature_tag,signature_sha256,signer_name,signing_method,witness_officer_id,terms_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [agreementId,protectedSignature.cipher,protectedSignature.iv,protectedSignature.tag,protectedSignature.sha256,
      signerName,actor.role!=='customer'?'officer_device_demo':'customer_session_demo',actor.role!=='customer'?actor.id:null,hash]);
}
