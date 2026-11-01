import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool,transaction} from '../lib/db';
import {addCharge,createQuickLoan,importLoan} from '../lib/manual';
import {perform} from '../lib/workflow';
import {loanBalances} from '../lib/ledger';
import {addDays,runAccruals,scheduleState,todayIso} from '../lib/accounting';
import {recordPayment} from '../lib/payments';
import {stopReceiptReader} from '../lib/receipt-reader';
import {demoActors,ensureWeeklyPolicy,pngReceipt,uniqueNik} from './helpers';

let actors:Awaited<ReturnType<typeof demoActors>>;
before(async()=>{actors=await demoActors();await ensureWeeklyPolicy(actors.owner);});
after(stopReceiptReader);
const borrower=()=>({name:`Nasabah Manual ${randomUUID().slice(0,6)}`,phone:'081234567890',nik:null,branchId:null,collectorId:actors.officer.id});
const status=async(id:string)=>(await pool.query('SELECT status FROM applications WHERE id=$1',[id])).rows[0].status;
const cashTotal=async()=>Number((await pool.query(`SELECT COALESCE(SUM(debit-credit),0)::bigint AS b FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account='cash' AND j.application_id=$1`,[null])).rows[0]?.b??0);

test('a manager enters a quick loan; the owner disburses it and the schedule starts from the transfer',async()=>{
  await assert.rejects(createQuickLoan(actors.officer,{...borrower(),principal:500000,weeks:5}),/Forbidden/);
  await assert.rejects(createQuickLoan(actors.manager,{...borrower(),collectorId:actors.manager.id,principal:500000,weeks:5}),/Collector required/);
  await assert.rejects(createQuickLoan(actors.manager,{...borrower(),principal:500000,weeks:9}),/Outside policy limits/);
  const {id}=await createQuickLoan(actors.manager,{...borrower(),principal:500000,weeks:5});
  assert.equal(await status(id),'signed');
  await pool.query(`UPDATE installments SET due_at=due_at-3 WHERE application_id=$1`,[id]);
  await perform(actors.owner,{type:'authorize',applicationId:id});
  await perform(actors.owner,{type:'initiate',applicationId:id,idempotencyKey:randomUUID()});
  await perform(actors.owner,{type:'confirm',applicationId:id,bankReference:`${Date.now()}${Math.floor(Math.random()*1e6)}`,proof:'Transfer uji'});
  assert.equal(await status(id),'active');
  const first=(await pool.query(`SELECT to_char(due_at,'YYYY-MM-DD') AS d FROM installments WHERE application_id=$1 AND sequence=1`,[id])).rows[0].d;
  assert.equal(first,addDays(todayIso(),7));
  assert.deepEqual(await transaction(c=>loanBalances(c,id)),{principal:500000,interest:125000,unearned:125000,fee:0,allowance:0});
});

test('an old loan is imported as active with its past schedule; what was paid before is an opening balance, not cash',async()=>{
  const disbursedOn=addDays(todayIso(),-24);
  const input={...borrower(),nik:uniqueNik(),principal:400000,weeks:4,interest:80000,disbursedOn,paid:240000};
  await assert.rejects(importLoan(actors.manager,{...input,paid:480000}),/already paid/);
  await assert.rejects(importLoan(actors.manager,{...input,disbursedOn:addDays(todayIso(),2)}),/Invalid import/);
  const cashBefore=await cashTotal();
  const {id}=await importLoan(actors.manager,input);
  assert.equal(await status(id),'active');
  assert.equal(await cashTotal(),cashBefore,'no cash moves');
  await assert.rejects(importLoan(actors.manager,{...input}),/open loan/);
  // Two of four weeks (2 × 120.000) were paid; week 3 fell due 3 days ago and is late.
  await transaction(async c=>{const app=(await c.query('SELECT * FROM applications WHERE id=$1 FOR UPDATE',[id])).rows[0];await runAccruals(c,app);});
  const state=await transaction(c=>scheduleState(c,id,todayIso()));
  assert.equal(state.dpd,3);
  const b=await transaction(c=>loanBalances(c,id));
  assert.equal(b.principal,200000);
  assert.equal(b.interest,40000,'interest still owed on weeks 3 and 4');
  assert.equal(b.unearned,20000,'week 3 interest earned when due; week 4 still unearned');
  assert.equal(b.fee,0,'no late fees for the time before import');
  const opening=(await pool.query(`SELECT method,status FROM payments WHERE application_id=$1`,[id])).rows[0];
  assert.deepEqual(opening,{method:'opening',status:'verified'});
});

test('an extra charge is owed first, then payments clear it before interest and principal',async()=>{
  const {id}=await importLoan(actors.owner,{...borrower(),branchId:actors.manager.branch_id,principal:300000,weeks:3,interest:60000,disbursedOn:todayIso(),paid:0});
  await assert.rejects(addCharge(actors.officer,id,'Biaya administrasi',10000,'uji'),/Forbidden/);
  await assert.rejects(addCharge(actors.manager,id,'Hadiah',10000,'uji'),/Invalid charge/);
  await addCharge(actors.manager,id,'Biaya administrasi',15000,'Biaya berkas');
  assert.equal((await transaction(c=>loanBalances(c,id))).fee,15000);
  const paid=await recordPayment(actors.manager,id,20000,pngReceipt());
  assert.equal(paid.allocation.fee,15000);
  const unbalanced=(await pool.query('SELECT journal_id FROM journal_lines GROUP BY journal_id HAVING SUM(debit)<>SUM(credit)')).rows;
  assert.equal(unbalanced.length,0);
});
