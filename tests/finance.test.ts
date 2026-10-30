import test from 'node:test';
import assert from 'node:assert/strict';
import {allocatePayment,assertBalanced,calculateFlatSchedule,calculateMonthlySchedule,canonicalJson} from '../lib/finance';
import {monthlyLateFee,monthlyTerms,normalizeWeeklyRates,weeklyTerms} from '../lib/terms';

test('weekly schedule exactly allocates IDR principal and interest',()=>{
  const result=calculateFlatSchedule(500001,200,8,new Date('2026-10-25T12:00:00Z'));
  assert.equal(result.interest,10000);
  assert.equal(result.total,510001);
  assert.equal(result.installments.reduce((n,i)=>n+i.principal,0),500001);
  assert.equal(result.installments.reduce((n,i)=>n+i.interest,0),10000);
  assert.equal(result.installments[0].dueAt,'2026-11-01');
});
test('monthly installments split principal and interest across the first of each next month',()=>{
  const result=calculateMonthlySchedule(500001,200,3,new Date('2026-10-25T12:00:00Z'));
  assert.equal(result.interest,10000);
  assert.equal(result.total,510001);
  assert.deepEqual(result.installments.map(item=>item.dueAt),['2026-11-01','2026-12-01','2027-01-01']);
  assert.equal(result.installments.reduce((sum,item)=>sum+item.principal,0),500001);
  assert.equal(result.installments.reduce((sum,item)=>sum+item.interest,0),10000);
  assert.ok(result.installments.every(item=>item.principal>0));
});
test('daily late fee uses the original principal and a fixed thirty-day divisor',()=>{
  assert.equal(monthlyLateFee(600000,500,1),1000);
  assert.equal(monthlyLateFee(600000,500,15),15000);
  assert.equal(monthlyLateFee(600000,500,30),30000);
  const quote=monthlyTerms('Nasabah Demo',600000,3,{id:'policy-demo',version:1,flat_interest_bps:200,late_fee_monthly_bps:500},new Date('2026-10-25T12:00:00Z'),'1234');
  assert.deepEqual(quote.snapshot.schedule.map(item=>item.dueAt),['2026-11-01','2026-12-01','2027-01-01']);
  assert.match(quote.terms.join(' '),/5% dari pokok awal per 30 hari/);
});
test('weekly terms add the tenor rate on top of principal and leave dates to approval',()=>{
  const policy={id:'policy-demo',version:1,weekly_rates:[{weeks:4,rateBps:2000},{weeks:5,rateBps:2500},{weeks:6,rateBps:3000}],late_fee_monthly_bps:500};
  const five=weeklyTerms('Nasabah Demo',500000,5,policy,'1234');
  assert.equal(five.snapshot.interest,125000);
  assert.equal(five.snapshot.total,625000);
  assert.deepEqual(five.snapshot.schedule.map(item=>item.principal+item.interest),[125000,125000,125000,125000,125000]);
  assert.ok(five.snapshot.schedule.every(item=>!('dueAt' in item)));
  assert.equal(weeklyTerms('Nasabah Demo',500000,4,policy,'1234').snapshot.total,600000);
  assert.equal(weeklyTerms('Nasabah Demo',500000,6,policy,'1234').snapshot.total,650000);
  assert.throws(()=>weeklyTerms('Nasabah Demo',500000,7,policy,'1234'),/Outside policy limits/);
  assert.throws(()=>normalizeWeeklyRates([{weeks:4,rateBps:2000},{weeks:4,rateBps:2500}]),/Invalid weekly rates/);
  assert.deepEqual(normalizeWeeklyRates([{weeks:8,rateBps:4000},{weeks:2,rateBps:1000}]).map(item=>item.weeks),[2,8]);
});
test('payments allocate interest first and reject overpayment',()=>{
  assert.deepEqual(allocatePayment(25000,500000,10000),{fee:0,interest:10000,principal:15000});
  assert.deepEqual(allocatePayment(25000,500000,10000,4000),{fee:4000,interest:10000,principal:11000});
  assert.throws(()=>allocatePayment(514001,500000,10000,4000),/Overpayment/);
  assert.throws(()=>allocatePayment(510001,500000,10000),/Overpayment/);
});
test('journals must balance',()=>{
  assert.doesNotThrow(()=>assertBalanced([{debit:100,credit:0},{debit:0,credit:100}]));
  assert.throws(()=>assertBalanced([{debit:100,credit:0},{debit:0,credit:99}]),/Unbalanced/);
});
test('agreement hashes are stable across JSON key ordering',()=>{
  assert.equal(canonicalJson({b:1,a:{d:2,c:3}}),canonicalJson({a:{c:3,d:2},b:1}));
});
