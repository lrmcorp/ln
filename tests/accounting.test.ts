import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {pool,transaction} from '../lib/db';
import {earlyPayoffQuote,proposeRestructure,runAccruals,scheduleState,todayIso,writeOff} from '../lib/accounting';
import {loanBalances} from '../lib/ledger';
import {monthlyLateFee} from '../lib/terms';
import {recordPayment,rejectPayment,reviewDeposit,submitDeposit,verifyPayment} from '../lib/payments';
import {signApplication,signingPreview} from '../lib/intake';
import {stopReceiptReader} from '../lib/receipt-reader';
import {accountBalance,activeWeeklyLoan,backdate,demoActors,ensureWeeklyPolicy,pngReceipt} from './helpers';

let actors:Awaited<ReturnType<typeof demoActors>>;
before(async()=>{actors=await demoActors();await ensureWeeklyPolicy(actors.owner);});
after(stopReceiptReader);

const accrue=(id:string)=>transaction(async c=>{
  const app=(await c.query('SELECT * FROM applications WHERE id=$1 FOR UPDATE',[id])).rows[0];
  await runAccruals(c,app);
});
const balances=(id:string)=>transaction(c=>loanBalances(c,id));

test('interest is deferred at disbursement and earned only as installments fall due',async()=>{
  const {id}=await activeWeeklyLoan(actors);
  assert.equal(await accountBalance(id,'interest_income'),0);
  assert.equal(-await accountBalance(id,'unearned_interest'),125000);
  await backdate(id,0);
  await accrue(id);
  await accrue(id);
  assert.equal(-await accountBalance(id,'interest_income'),25000,'week 1 interest recognised once');
  assert.equal(-await accountBalance(id,'unearned_interest'),100000);
});

test('late fees accrue daily on original principal, are paid first, and drive provisions',async()=>{
  const {id}=await activeWeeklyLoan(actors);
  await backdate(id,10);
  await accrue(id);
  await accrue(id);
  const b=await balances(id);
  assert.equal(b.fee,monthlyLateFee(500000,500,10));
  const state=await transaction(c=>scheduleState(c,id,todayIso()));
  assert.equal(state.dpd,10);
  assert.equal(b.allowance,Math.round(b.principal*0.25),'8 to 30 days past due reserves 25%');
  const paid=await recordPayment(actors.manager,id,10000,pngReceipt());
  assert.deepEqual(paid.allocation,{fee:b.fee,interest:10000-b.fee,principal:0});
});

test('officer cash payments wait for verification, rejection reverses the ledger, deposits reconcile',async()=>{
  const {id}=await activeWeeklyLoan(actors);
  await accrue(id);
  const before=await balances(id);
  const cash=await recordPayment(actors.officer,id,125000,pngReceipt(),{method:'cash'});
  assert.equal(cash.status,'pending');
  await assert.rejects(verifyPayment(actors.officer,cash.paymentId),/Forbidden/);
  await assert.rejects(rejectPayment(actors.manager,cash.paymentId,''),/Reason required/);
  await rejectPayment(actors.manager,cash.paymentId,'Bukti tidak cocok dengan mutasi');
  assert.deepEqual(await balances(id),before);
  await assert.rejects(verifyPayment(actors.manager,cash.paymentId),/already reviewed/);

  const good=await recordPayment(actors.officer,id,125000,pngReceipt(),{method:'cash'});
  await verifyPayment(actors.manager,good.paymentId,'Cocok');
  const day=todayIso();
  // Other tests may record cash today for the same officer, so compare against the reported expectation.
  const deposit=await submitDeposit(actors.officer,day,120000,pngReceipt());
  assert.equal(deposit.difference,120000-deposit.expected);
  // A short deposit leaves the rest owed, and a follow-up deposit the same day is accepted.
  const topUp=await submitDeposit(actors.officer,day,deposit.expected-120000,pngReceipt());
  assert.equal(topUp.expected,deposit.expected-120000);
  assert.equal(topUp.difference,0);
  await reviewDeposit(actors.manager,deposit.id,true);
  // Other suites move company cash in parallel, so check this deposit's own journal.
  const moved=(await pool.query(`SELECT SUM(l.debit-l.credit)::bigint AS cash FROM journal_lines l JOIN journals j ON j.id=l.journal_id
    WHERE j.event_type='cash_deposit' AND j.source_id=$1 AND l.account='cash'`,[deposit.id])).rows[0];
  assert.equal(Number(moved.cash),120000);
  await assert.rejects(reviewDeposit(actors.manager,deposit.id,true),/already reviewed/);
});

test('early payoff waives unearned interest and releases the provision',async()=>{
  const {id}=await activeWeeklyLoan(actors);
  await backdate(id,0);
  await accrue(id);
  const b=await balances(id);
  const quote=earlyPayoffQuote(b);
  assert.equal(quote,500000+25000);
  await assert.rejects(recordPayment(actors.manager,id,quote-1,pngReceipt(),{earlyPayoff:true}),/Early payoff amount mismatch/);
  await recordPayment(actors.manager,id,quote,pngReceipt(),{earlyPayoff:true});
  assert.equal((await pool.query('SELECT status FROM applications WHERE id=$1',[id])).rows[0].status,'paid_off');
  assert.deepEqual(await balances(id),{principal:0,interest:0,unearned:0,fee:0,allowance:0});
});

test('write-off clears receivables after 30 days past due and later recoveries are income',async()=>{
  const {id}=await activeWeeklyLoan(actors);
  await backdate(id,10);
  await assert.rejects(writeOff(actors.owner,id,'Tidak dapat dihubungi'),/30 days/);
  await backdate(id,40);
  await assert.rejects(writeOff(actors.manager,id,'x'),/Forbidden/);
  const result=await writeOff(actors.owner,id,'Tidak dapat dihubungi 40 hari');
  const b=await balances(id);
  assert.deepEqual({p:b.principal,i:b.interest,f:b.fee,u:b.unearned,a:b.allowance},{p:0,i:0,f:0,u:0,a:0});
  assert.ok(result.amount>=625000);
  await recordPayment(actors.manager,id,50000,pngReceipt());
  assert.equal(-await accountBalance(id,'recovery_income'),50000);
  await assert.rejects(recordPayment(actors.manager,id,result.amount,pngReceipt()),/Overpayment/);
});

test('restructuring reschedules the remaining balance only after the borrower signs',async()=>{
  const {id,name}=await activeWeeklyLoan(actors);
  await recordPayment(actors.manager,id,125000,pngReceipt());
  await backdate(id,20);
  await accrue(id);
  const before=await balances(id);
  await proposeRestructure(actors.owner,id,8,'Usaha nasabah sepi, disepakati perpanjangan');
  assert.ok((await transaction(c=>scheduleState(c,id,todayIso()))).dpd>0,'old schedule applies until signed');
  const preview=await signingPreview(actors.officer,id);
  assert.ok('weeks' in preview.quote.snapshot&&preview.quote.snapshot.weeks===8);
  assert.equal(preview.quote.snapshot.total,before.principal+before.interest);
  const signature=Buffer.from([137,80,78,71,13,10,26,10,...Array(300).fill(0)]);
  await signApplication(actors.officer,id,name,true,preview.quote.hash,signature);
  const state=await transaction(c=>scheduleState(c,id,todayIso()));
  assert.equal(state.dpd,0);
  assert.equal(state.rows.length,9,'one settled row plus eight new weeks');
  assert.equal(state.rows.slice(1).reduce((sum,row)=>sum+row.principal+row.interest,0),before.principal+before.interest);
  assert.equal((await balances(id)).fee,before.fee,'recorded late fees stay owed');
});

test('every journal balances',async()=>{
  const unbalanced=(await pool.query('SELECT journal_id FROM journal_lines GROUP BY journal_id HAVING SUM(debit)<>SUM(credit)')).rows;
  assert.equal(unbalanced.length,0);
});
