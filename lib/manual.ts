import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Actor} from './auth';
import {requireRole} from './auth';
import {transaction} from './db';
import {calculateFlatSchedule} from './finance';
import {A,cr,dr,journal} from './ledger';
import {addDays,todayIso,daysBetween} from './accounting';
import {weeklyRate,weeklyTerms} from './terms';
import {borrowingLimit,nikHashOf} from './intake';
import {assertExposure} from './exposure';
import {audit,locked,inScope} from './workflow';

// Staff-entered loans: a quick new loan without the field intake, and import of a loan that began outside the app.
type Borrower={name:string;phone:string;nik?:string|null;branchId?:string|null;collectorId:string};
export type QuickLoanInput=Borrower&{principal:number;weeks:number};
export type ImportLoanInput=Borrower&{principal:number;weeks:number;interest:number;disbursedOn:string;paid:number};

function assertBorrower(input:Borrower){
  if(!input.name?.trim()||input.name.length>200||!/^[0-9+ -]{8,20}$/.test(input.phone??'')||(input.nik&&!/^[0-9]{16}$/.test(input.nik)))throw new Error('Invalid borrower details');
}

// The branch is the manager's own; an owner names it. The collector must be an active officer there.
async function placement(c:PoolClient,actor:Actor,input:Borrower){
  const branchId=actor.role==='manager'?actor.branch_id!:input.branchId??'';
  const officer=(await c.query(`SELECT id FROM users WHERE id::text=$1 AND role='officer' AND active AND branch_id::text=$2`,[input.collectorId,branchId])).rows[0];
  if(!officer)throw new Error('Collector required');
  return {branchId,collectorId:officer.id as string};
}

// Finds the borrower by NIK when one is given, otherwise creates a record without one.
async function borrower(c:PoolClient,input:Borrower,branchId:string){
  if(input.nik){
    const existing=(await c.query('SELECT id,name,branch_id FROM customers WHERE nik_hash=$1 FOR UPDATE',[nikHashOf(input.nik)])).rows[0];
    if(existing){
      if(existing.branch_id!==branchId)throw new Error('Customer registered in another branch');
      if((await c.query(`SELECT 1 FROM applications WHERE customer_id=$1 AND status NOT IN ('paid_off','closed','rejected','written_off') LIMIT 1`,[existing.id])).rows[0])throw new Error('Customer has an open loan');
      await c.query('UPDATE customers SET phone=$1 WHERE id=$2',[input.phone.trim(),existing.id]);
      return {id:existing.id as string,existing:true};
    }
  }
  const row=(await c.query(`INSERT INTO customers(name,nik_hash,nik_last4,phone,branch_id) VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [input.name.trim(),input.nik?nikHashOf(input.nik):null,input.nik?input.nik.slice(-4):null,input.phone.trim(),branchId])).rows[0];
  return {id:row.id as string,existing:false};
}

// Ready to disburse: terms are recorded as accepted by the staff member, the schedule is set when the money goes out.
export async function createQuickLoan(actor:Actor|null,input:QuickLoanInput){
  requireRole(actor,['owner','manager']);
  assertBorrower(input);
  return transaction(async c=>{
    const policy=(await c.query('SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
    if(!policy)throw new Error('No active policy');
    if(!Number.isSafeInteger(input.principal)||input.principal<Number(policy.min_principal)||input.principal>Number(policy.max_principal))throw new Error('Outside policy limits');
    weeklyRate(policy.weekly_rates,input.weeks);
    const {branchId,collectorId}=await placement(c,actor,input);
    const customer=await borrower(c,input,branchId);
    const {limit}=await borrowingLimit(c,customer.existing?customer.id:null,policy);
    if(input.principal>limit)throw new Error('Above borrowing limit');
    await c.query('SELECT pg_advisory_xact_lock(710103)');
    await assertExposure(c,policy,{collectorId,branchId,principal:input.principal});
    const quote=weeklyTerms(input.name.trim(),input.principal,input.weeks,policy,'----');
    const app=(await c.query(`INSERT INTO applications(customer_id,officer_id,collector_id,branch_id,policy_id,requested_principal,approved_principal,interest_amount,term_weeks,
        repayment_frequency,status,approved_at,origin) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,'weekly_from_approval','signed',now(),'quick') RETURNING id`,
      [customer.id,actor.id,collectorId,branchId,policy.id,input.principal,quote.snapshot.interest,input.weeks])).rows[0];
    await c.query(`INSERT INTO agreements(application_id,version,snapshot,snapshot_hash,signed_at,signed_by,signature_receipt) VALUES($1,1,$2,$3,now(),$4,$5)`,
      [app.id,JSON.stringify(quote.snapshot),quote.hash,actor.id,`staff-recorded:${randomUUID()}`]);
    const schedule=calculateFlatSchedule(input.principal,quote.snapshot.rateBps,input.weeks,new Date(`${todayIso()}T00:00:00Z`));
    for(const item of schedule.installments)await c.query('INSERT INTO installments(application_id,sequence,due_at,principal,interest) VALUES($1,$2,$3,$4,$5)',
      [app.id,item.sequence,item.dueAt,item.principal,item.interest]);
    await audit(c,actor,app.id,'quick_loan_created',null,{principal:input.principal,weeks:input.weeks,collectorId,branchId},'Dibuat staf tanpa formulir lapangan');
    return {id:app.id as string};
  });
}

// Brings an existing loan in as active: the schedule runs weekly from its original disbursement date,
// what was paid before is recorded against an opening-balance account, and no cash moves in the app's books.
export async function importLoan(actor:Actor|null,input:ImportLoanInput){
  requireRole(actor,['owner','manager']);
  assertBorrower(input);
  const today=todayIso();
  if(!Number.isSafeInteger(input.principal)||input.principal<=0||input.principal>10_000_000_000||!Number.isSafeInteger(input.weeks)||input.weeks<1||input.weeks>104||
    !Number.isSafeInteger(input.interest)||input.interest<0||input.interest>input.principal*2||!/^\d{4}-\d{2}-\d{2}$/.test(input.disbursedOn)||input.disbursedOn>today||
    daysBetween(input.disbursedOn,today)>730||!Number.isSafeInteger(input.paid)||input.paid<0)throw new Error('Invalid import');
  const total=input.principal+input.interest;
  if(input.paid>=total)throw new Error('Imported loan already paid');
  return transaction(async c=>{
    const policy=(await c.query('SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
    if(!policy)throw new Error('No active policy');
    const {branchId,collectorId}=await placement(c,actor,input);
    const customer=await borrower(c,input,branchId);
    const rows=Array.from({length:input.weeks},(_,i)=>({sequence:i+1,dueAt:addDays(input.disbursedOn,7*(i+1)),
      principal:Math.floor(input.principal/input.weeks)+(i<input.principal%input.weeks?1:0),interest:Math.floor(input.interest/input.weeks)+(i<input.interest%input.weeks?1:0)}));
    const rateBps=Math.round(input.interest*10000/input.principal);
    const snapshot={principal:input.principal,interest:input.interest,total,weeks:input.weeks,rateBps,lateFeeMonthlyBps:Number(policy.late_fee_monthly_bps),policyVersion:policy.version,
      policyId:policy.id,repaymentFrequency:'weekly_from_approval',schedule:rows.map(({sequence,principal,interest})=>({sequence,principal,interest})),imported:true,
      terms:[`Pinjaman lama yang dimasukkan staf. Pokok ${input.principal}, bunga ${input.interest}, ${input.weeks} minggu sejak ${input.disbursedOn}. Perjanjian asli disimpan di luar aplikasi.`]};
    const app=(await c.query(`INSERT INTO applications(customer_id,officer_id,collector_id,branch_id,policy_id,requested_principal,approved_principal,interest_amount,term_weeks,
        repayment_frequency,status,approved_at,disbursed_at,interest_deferred,fee_accrued_through,origin)
      VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,'weekly_from_approval','active',$9::date,$9::date,true,$10,'imported') RETURNING id`,
      [customer.id,actor.id,collectorId,branchId,policy.id,input.principal,input.interest,input.weeks,input.disbursedOn,today])).rows[0];
    const {createHash}=await import('node:crypto');
    await c.query(`INSERT INTO agreements(application_id,version,snapshot,snapshot_hash,signed_at,signed_by,signature_receipt) VALUES($1,1,$2,$3,$4::date,$5,$6)`,
      [app.id,JSON.stringify(snapshot),createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),input.disbursedOn,actor.id,`imported:${randomUUID()}`]);
    // Installments already covered by the opening payment are marked recognised so their interest is not earned again.
    let left=input.paid,paidPrincipal=0,paidInterest=0;
    for(const row of rows){
      const coverInterest=Math.min(left,row.interest);left-=coverInterest;
      const coverPrincipal=Math.min(left,row.principal);left-=coverPrincipal;
      paidInterest+=coverInterest;paidPrincipal+=coverPrincipal;
      await c.query('INSERT INTO installments(application_id,sequence,due_at,principal,interest,interest_recognized) VALUES($1,$2,$3,$4,$5,$6)',
        [app.id,row.sequence,row.dueAt,row.principal,row.interest,coverInterest===row.interest&&coverPrincipal===row.principal]);
    }
    await journal(c,app.id,'opening_loan',app.id,[dr(A.principal,input.principal),dr(A.interest,input.interest),cr(A.openingBalance,input.principal),cr(A.unearned,input.interest)]);
    if(input.paid>0){
      const p=(await c.query(`INSERT INTO payments(application_id,amount,principal,interest,fee,verified_by,method,status,amount_source,bank_reference,created_at,reviewed_by,reviewed_at,review_note)
        VALUES($1,$2,$3,$4,0,$5,'opening','verified','entered',NULL,$6::date,$5,now(),'Sudah dibayar sebelum masuk aplikasi') RETURNING id`,
        [app.id,input.paid,paidPrincipal,paidInterest,actor.id,input.disbursedOn])).rows[0];
      await journal(c,app.id,'opening_payment',p.id,[dr(A.openingBalance,paidPrincipal),dr(A.unearned,paidInterest),cr(A.principal,paidPrincipal),cr(A.interest,paidInterest)]);
    }
    await audit(c,actor,app.id,'loan_imported',null,{principal:input.principal,interest:input.interest,weeks:input.weeks,disbursedOn:input.disbursedOn,paid:input.paid,collectorId});
    return {id:app.id as string};
  });
}

const CHARGE_KINDS=['Biaya administrasi','Denda manual','Biaya kunjungan','Lainnya'];
// An extra charge on a running loan, owed before interest and principal like a late fee.
export async function addCharge(actor:Actor|null,applicationId:string,kind:string,amount:number,reason:string){
  requireRole(actor,['owner','manager']);
  if(!CHARGE_KINDS.includes(kind)||!Number.isSafeInteger(amount)||amount<=0||!reason.trim()||reason.length>300)throw new Error('Invalid charge');
  return transaction(async c=>{
    const app=await locked(c,applicationId);
    inScope(actor,app);
    if(app.status!=='active')throw new Error('Loan is not active');
    if(amount>Number(app.approved_principal))throw new Error('Invalid charge');
    const row=(await c.query('INSERT INTO manual_charges(application_id,kind,amount,reason,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[app.id,kind,amount,reason.trim(),actor.id])).rows[0];
    await journal(c,app.id,'manual_charge',row.id,[dr(A.fee,amount),cr(A.otherFeeIncome,amount)]);
    await audit(c,actor,app.id,'manual_charge',null,{kind,amount},reason.trim());
    return {id:row.id as string};
  });
}
