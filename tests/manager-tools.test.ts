import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../lib/db';
import {borrowerGrade} from '../lib/grade';
import {earlyPayoffQuote} from '../lib/accounting';
import {loanBalances} from '../lib/ledger';
import {transaction} from '../lib/db';
import {recordPayment} from '../lib/payments';
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

test('close all paid-off loans closes only those with nothing awaiting verification',async()=>{
  const clean=await activeWeeklyLoan(actors);
  const held=await activeWeeklyLoan(actors);
  for(const loan of [clean,held]){
    const quote=earlyPayoffQuote(await transaction(c=>loanBalances(c,loan.id)));
    await recordPayment(loan===held?actors.officer:actors.manager,loan.id,quote,pngReceipt(),{earlyPayoff:true,method:loan===held?'cash':'transfer'});
  }
  await assert.rejects(closePaidOff(actors.manager),/Forbidden/);
  const result=await closePaidOff(actors.owner);
  assert.ok(result.closed>=1);
  const status=async(id:string)=>(await pool.query('SELECT status FROM applications WHERE id=$1',[id])).rows[0].status;
  assert.equal(await status(clean.id),'closed');
  assert.equal(await status(held.id),'paid_off','officer cash payoff waits for verification first');
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
