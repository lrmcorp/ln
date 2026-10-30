import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../lib/db';
import {borrowerGrade} from '../lib/grade';
import {addDays,earlyPayoffQuote,todayIso} from '../lib/accounting';
import {dailyTargets,rollRates,type LoanRow} from '../lib/reports';
import {loanBalances} from '../lib/ledger';
import {transaction} from '../lib/db';
import {recordPayment,verifyPayment} from '../lib/payments';
import {closePaidOff} from '../lib/workflow';
import {homeDashboard} from '../lib/dashboard';
import {stopReceiptReader} from '../lib/receipt-reader';
import {activeWeeklyLoan,backdate,demoActors,ensureWeeklyPolicy,pngReceipt} from './helpers';

let actors:Awaited<ReturnType<typeof demoActors>>;
before(async()=>{actors=await demoActors();await ensureWeeklyPolicy(actors.owner);});
after(stopReceiptReader);

test('borrower grade follows the worst lateness across loans',()=>{
  assert.equal(borrowerGrade({loans:0,worstDpd:0,writtenOff:false}).grade,'Baru');
  assert.equal(borrowerGrade({loans:2,worstDpd:0,writtenOff:false}).grade,'A');
  assert.equal(borrowerGrade({loans:1,worstDpd:7,writtenOff:false}).grade,'B');
  assert.equal(borrowerGrade({loans:1,worstDpd:8,writtenOff:false}).grade,'C');
  assert.equal(borrowerGrade({loans:1,worstDpd:31,writtenOff:false}).grade,'D');
  assert.equal(borrowerGrade({loans:1,worstDpd:0,writtenOff:true}).grade,'D');
});

test('paid-off loans close themselves once nothing awaits verification; close-all stays owner-only',async()=>{
  const clean=await activeWeeklyLoan(actors);
  const held=await activeWeeklyLoan(actors);
  for(const loan of [clean,held]){
    const quote=earlyPayoffQuote(await transaction(c=>loanBalances(c,loan.id)));
    await recordPayment(loan===held?actors.officer:actors.manager,loan.id,quote,pngReceipt(),{earlyPayoff:true,method:loan===held?'cash':'transfer'});
  }
  await assert.rejects(closePaidOff(actors.manager),/Forbidden/);
  await closePaidOff(actors.owner);
  const status=async(id:string)=>(await pool.query('SELECT status FROM applications WHERE id=$1',[id])).rows[0].status;
  assert.equal(await status(clean.id),'closed');
  assert.equal(await status(held.id),'paid_off','officer cash payoff waits for verification first');
  const pending=(await pool.query(`SELECT id FROM payments WHERE application_id=$1 AND status='pending'`,[held.id])).rows[0];
  await verifyPayment(actors.manager,pending.id);
  assert.equal(await status(held.id),'closed');
});

test('dashboard reports aging that adds up to principal outstanding and owner liquidity',async()=>{
  const {id}=await activeWeeklyLoan(actors);
  await backdate(id,10);
  const data=await homeDashboard(actors.owner);
  assert.equal(data.aging.reduce((s,row)=>s+row.amount,0),data.outstanding);
  assert.ok(data.aging.find(row=>row.key==='d30')!.count>=1);
  assert.ok(data.liquidity);
  assert.equal(data.liquidity!.afterReady,data.liquidity!.cash-data.liquidity!.ready);
  assert.equal((await homeDashboard(actors.manager)).liquidity,null,'managers do not see company cash');
});

test('the grade sets the repeat limit: A grows, B holds, C restarts, D is refused',async()=>{
  const {borrowingLimit}=await import('../lib/intake');
  const policy=(await pool.query('SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
  const loan=await activeWeeklyLoan(actors,800000);
  const quote=earlyPayoffQuote(await transaction(c=>loanBalances(c,loan.id)));
  await recordPayment(actors.manager,loan.id,quote,pngReceipt(),{earlyPayoff:true});
  const customer=(await pool.query('SELECT customer_id FROM applications WHERE id=$1',[loan.id])).rows[0].customer_id;
  const limitAt=async(dpd:number)=>{await pool.query('UPDATE applications SET max_dpd=$2 WHERE id=$1',[loan.id,dpd]);return transaction(c=>borrowingLimit(c,customer,policy));};
  assert.equal((await limitAt(0)).limit,1200000);
  assert.equal((await limitAt(5)).limit,1000000,'B keeps the last amount, floored at the first-loan cap');
  assert.equal((await limitAt(20)).limit,1000000);
  assert.match((await limitAt(20)).reason,/Kelas C/);
  assert.equal((await limitAt(45)).limit,0);
});

test('exposure limits stop new intake for an officer at the cap',async()=>{
  const policy=(await pool.query('SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
  const {perform}=await import('../lib/workflow');
  const base={type:'policy' as const,minPrincipal:Number(policy.min_principal),maxPrincipal:Number(policy.max_principal),weeklyRates:policy.weekly_rates};
  await perform(actors.owner,{...base,maxOfficerExposure:1,maxBranchExposure:0});
  try{await assert.rejects(activeWeeklyLoan(actors),/Officer exposure limit reached/);}
  finally{await perform(actors.owner,{...base,maxOfficerExposure:0,maxBranchExposure:0});}
});

const synthetic=(over:Partial<LoanRow>):LoanRow=>({id:'x',status:'active',branch_id:'b',branch_name:'B',collector_id:'o',collector_name:'Petugas',customer_name:'N',principal:400,interest:0,
  disbursed_at:addDays(todayIso(),-30),paid:0,collected_total:0,recovery:0,outstanding_principal:400,receivable:400,rows:[],paidLog:[],term_weeks:4,...over});

test('daily target counts what fell due and was unpaid this morning, capped per loan',()=>{
  const today=todayIso();
  const loan=synthetic({rows:[{dueAt:addDays(today,-7),amount:100},{dueAt:today,amount:100},{dueAt:addDays(today,7),amount:100}],
    paidLog:[{at:addDays(today,-3),amount:50},{at:today,amount:200}]});
  const [o]=dailyTargets([loan],today);
  assert.deepEqual({target:o.target,collected:o.collected,received:o.received,rate:o.rate},{target:150,collected:150,received:200,rate:100});
});

test('roll rate tracks loans moving to a worse bucket week over week',()=>{
  const today=todayIso();
  const worse=synthetic({id:'w',rows:[{dueAt:addDays(today,-10),amount:100},{dueAt:addDays(today,20),amount:100}]});
  const cured=synthetic({id:'c',rows:[{dueAt:addDays(today,-10),amount:100},{dueAt:addDays(today,20),amount:100}],paidLog:[{at:addDays(today,-1),amount:100}]});
  const fine=synthetic({id:'f',rows:[{dueAt:addDays(today,5),amount:100}]});
  const last=rollRates([worse,cured,fine],today,1)[0];
  assert.equal(last.d7Base,2);assert.equal(last.d7ToD30,50);
  assert.equal(last.cure,50);assert.equal(last.currentToLate,0);
});

test('operating expenses are journaled against cash and fully allocated to loans',async()=>{
  const {recordExpense,profitReport}=await import('../lib/profit');
  await assert.rejects(recordExpense(actors.manager,{month:todayIso().slice(0,7),category:'Sewa',branchId:null,amount:1000,note:''}),/Forbidden/);
  const before=await profitReport(actors.owner);
  await recordExpense(actors.owner,{month:todayIso().slice(0,7),category:'Sewa',branchId:null,amount:1000,note:'uji'});
  const after=await profitReport(actors.owner);
  assert.equal(after.expenseTotal-before.expenseTotal,1000);
  assert.ok(Math.abs(after.total!.operating-after.expenseTotal)<=after.total!.loans,'allocation adds up within rounding');
  const unbalanced=(await pool.query('SELECT journal_id FROM journal_lines GROUP BY journal_id HAVING SUM(debit)<>SUM(credit)')).rows;
  assert.equal(unbalanced.length,0);
});

test('a branch manager can originate a loan for an officer, who collects it and can take the signature',async()=>{
  const {createIntake,signApplication,signingPreview}=await import('../lib/intake');
  const {ktp,video,uniqueNik}=await import('./helpers');
  const name='Nasabah Manajer Uji';
  const base={nik:uniqueNik(),dateOfBirth:'1990-01-01',phone:'081234567890',address:'Alamat rekaan',motherName:'Ibu Rekaan',bankName:'Bank Demo',
    bankAccountNumber:'1234567890',accountHolder:name,occupation:'',loanPurpose:'',principal:500000,weeks:5,weeklyIncome:2000000,name};
  await assert.rejects(createIntake(actors.manager,{...base,collectorId:null},ktp,video),/Collector required/);
  await assert.rejects(createIntake(actors.manager,{...base,collectorId:actors.manager.id},ktp,video),/Collector required/,'collector must be an officer');
  const {id}=await createIntake(actors.manager,{...base,collectorId:actors.officer.id},ktp,video);
  const row=(await pool.query('SELECT officer_id,collector_id FROM applications WHERE id=$1',[id])).rows[0];
  assert.deepEqual(row,{officer_id:actors.manager.id,collector_id:actors.officer.id});
  await assert.rejects(createIntake(actors.owner,{...base,nik:uniqueNik()},ktp,video),/Forbidden/);
  const preview=await signingPreview(actors.officer,id);
  await signApplication(actors.officer,id,name,true,preview.quote.hash,Buffer.from([137,80,78,71,13,10,26,10,...Array(300).fill(0)]));
  assert.equal((await pool.query('SELECT status FROM applications WHERE id=$1',[id])).rows[0].status,'signed_pending_approval');
});

test('owner can reject an application with a reason before money moves',async()=>{
  const {createIntake}=await import('../lib/intake');
  const {perform}=await import('../lib/workflow');
  const {ktp,video,uniqueNik}=await import('./helpers');
  const {id}=await createIntake(actors.officer,{nik:uniqueNik(),dateOfBirth:'1990-01-01',phone:'081234567890',address:'Alamat rekaan',motherName:'Ibu Rekaan',bankName:'Bank Demo',
    bankAccountNumber:'1234567890',accountHolder:'Nasabah Tolak',occupation:'',loanPurpose:'',principal:300000,weeks:4,weeklyIncome:2000000,name:'Nasabah Tolak'},ktp,video,
    {photo:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(40)]),latitude:-6.200123,longitude:106.816666,accuracyM:20});
  const place=(await pool.query('SELECT latitude::float AS lat,longitude::float AS lng,accuracy_m FROM intake_place WHERE application_id=$1',[id])).rows[0];
  assert.deepEqual(place,{lat:-6.2,lng:106.817,accuracy_m:100},'coordinates rounded to about 100 m');
  await assert.rejects(perform(actors.manager,{type:'reject',applicationId:id,reason:'x'}),/Forbidden/);
  await assert.rejects(perform(actors.owner,{type:'reject',applicationId:id,reason:' '}),/Reason required/);
  await perform(actors.owner,{type:'reject',applicationId:id,reason:'Pendapatan tidak cukup'});
  assert.equal((await pool.query('SELECT status FROM applications WHERE id=$1',[id])).rows[0].status,'rejected');
  await assert.rejects(perform(actors.owner,{type:'reject',applicationId:id,reason:'lagi'}),/Rejection not allowed/);
});

test('customer profile is scoped by role',async()=>{
  const {customerProfile}=await import('../lib/customers');
  const {id}=await activeWeeklyLoan(actors);
  const customerId=(await pool.query('SELECT customer_id FROM applications WHERE id=$1',[id])).rows[0].customer_id;
  const profile=await customerProfile(actors.officer,customerId);
  assert.equal(profile.loans[0].id,id);
  assert.equal((await customerProfile(actors.owner,customerId)).grade.grade,'A');
  const stranger={...actors.officer,id:(await pool.query(`SELECT gen_random_uuid() AS id`)).rows[0].id};
  await assert.rejects(customerProfile(stranger,customerId),/Forbidden/);
});
