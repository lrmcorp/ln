import test from 'node:test';
import assert from 'node:assert/strict';
import {allocatePayment,assertBalanced,calculateFlatSchedule,canonicalJson} from '../lib/finance';

test('weekly schedule exactly allocates IDR principal and interest',()=>{
  const result=calculateFlatSchedule(500001,200,8,new Date('2026-10-25T12:00:00Z'));
  assert.equal(result.interest,10000);
  assert.equal(result.total,510001);
  assert.equal(result.installments.reduce((n,i)=>n+i.principal,0),500001);
  assert.equal(result.installments.reduce((n,i)=>n+i.interest,0),10000);
  assert.equal(result.installments[0].dueAt,'2026-11-01');
});
test('payments allocate interest first and reject overpayment',()=>{
  assert.deepEqual(allocatePayment(25000,500000,10000),{interest:10000,principal:15000});
  assert.throws(()=>allocatePayment(510001,500000,10000),/Overpayment/);
});
test('journals must balance',()=>{
  assert.doesNotThrow(()=>assertBalanced([{debit:100,credit:0},{debit:0,credit:100}]));
  assert.throws(()=>assertBalanced([{debit:100,credit:0},{debit:0,credit:99}]),/Unbalanced/);
});
test('agreement hashes are stable across JSON key ordering',()=>{
  assert.equal(canonicalJson({b:1,a:{d:2,c:3}}),canonicalJson({a:{c:3,d:2},b:1}));
});
