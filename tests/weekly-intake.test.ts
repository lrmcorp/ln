import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pool} from '../lib/db';
import type {Actor} from '../lib/auth';
import {createIntake,signApplication,signingPreview} from '../lib/intake';
import {readIntakeEvidence} from '../lib/evidence';
import {perform,readPaymentReceipt,recordPayment} from '../lib/workflow';
import {jakartaToday} from '../lib/finance';
import {stopReceiptReader} from '../lib/receipt-reader';

after(stopReceiptReader);

const receipt=()=>Buffer.concat([Buffer.from([255,216,255]),Buffer.from(randomUUID()),Buffer.from([255,217])]);

test('weekly intake starts installments at approval and staff record receipted payments',async()=>{
  const users=await pool.query<Actor>('SELECT id,name,email,role,branch_id,customer_id FROM users WHERE email IN ($1,$2,$3)',
    ['owner@local.test','officer@local.test','manager@local.test']);
  const owner=users.rows.find(item=>item.role==='owner')!,officer=users.rows.find(item=>item.role==='officer')!,manager=users.rows.find(item=>item.role==='manager')!;
  assert.ok(owner&&officer&&manager);
  await perform(owner,{type:'policy',minPrincipal:100000,maxPrincipal:5000000,weeklyRates:[{weeks:4,rateBps:2000},{weeks:5,rateBps:2500},{weeks:6,rateBps:3000}]});
  const nik=`${randomUUID().replace(/\D/g,'').padEnd(16,'0').slice(0,16)}`;
  const ktp=Buffer.from([255,216,255,...Array(20).fill(0),255,217]);
  const video=Buffer.from([26,69,223,163,...Array(20).fill(0)]);
  const details={name:'Nasabah Uji Mingguan',nik,dateOfBirth:'1990-01-01',phone:'081234567890',address:'Alamat rekaan',motherName:'Ibu Rekaan',
    bankName:'Bank Demo',bankAccountNumber:'1234567890',accountHolder:'Nasabah Uji Mingguan',occupation:'',loanPurpose:''};
  await assert.rejects(createIntake(officer,{...details,principal:500000,weeks:7},ktp,video),/Outside policy limits/);
  const {id}=await createIntake(officer,{...details,principal:500000,weeks:5},ktp,video);
  await assert.rejects(perform(owner,{type:'approve',applicationId:id}),/Approval not allowed/);
  assert.deepEqual((await readIntakeEvidence(owner,id,'ktp')).data,ktp);
  const preview=await signingPreview(officer,id);
  assert.ok('weeks' in preview.quote.snapshot);
  assert.equal(preview.quote.snapshot.total,625000);
  assert.equal(preview.quote.snapshot.schedule.length,5);
  const signature=Buffer.from([137,80,78,71,13,10,26,10,...Array(300).fill(0)]);
  await assert.rejects(signApplication(officer,id,'Nasabah Uji Mingguan',true,'0'.repeat(64),signature),/Terms changed/);
  await signApplication(officer,id,'Nasabah Uji Mingguan',true,preview.quote.hash,signature);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM installments WHERE application_id=$1',[id])).rows[0].n,0,'no dates before approval');
  await assert.rejects(perform(owner,{type:'approve',applicationId:id}),/Identity review required/);
  await perform(owner,{type:'review_evidence',applicationId:id,reason:'Bukti rekaan ditinjau'});
  await perform(owner,{type:'approve',applicationId:id});
  const due=(await pool.query(`SELECT to_char(due_at,'YYYY-MM-DD') AS due,principal+interest AS amount FROM installments WHERE application_id=$1 ORDER BY sequence`,[id])).rows;
  const start=jakartaToday();
  assert.deepEqual(due.map(row=>row.due),[1,2,3,4,5].map(week=>new Date(start.getTime()+week*7*86400000).toISOString().slice(0,10)));
  assert.ok(due.every(row=>Number(row.amount)===125000));
  await perform(owner,{type:'authorize',applicationId:id});
  await perform(owner,{type:'initiate',applicationId:id,idempotencyKey:randomUUID()});
  await perform(owner,{type:'confirm',applicationId:id,bankReference:`${Date.now()}`,proof:'Bukti penyelesaian demo'});
  const first=receipt();
  const paid=await recordPayment(manager,id,100000,null,first);
  assert.equal(paid.remaining,525000);
  await assert.rejects(recordPayment(manager,id,100000,null,first),/duplicate key/);
  await assert.rejects(recordPayment({...manager,branch_id:randomUUID()},id,100000,null,receipt()),/Forbidden/);
  await assert.rejects(readPaymentReceipt({...manager,branch_id:randomUUID()},paid.paymentId),/Forbidden/);
  assert.deepEqual((await readPaymentReceipt(manager,paid.paymentId)).data,first);
  await assert.rejects(recordPayment(manager,id,525001,null,receipt()),/Overpayment/);
  // Field officer: blank nominal is read from the receipt photo (trailing bytes keep each run's receipt hash unique).
  const photo=Buffer.concat([readFileSync(new URL('./fixtures/receipt-kwitansi.png',import.meta.url)),Buffer.from(randomUUID())]);
  await assert.rejects(recordPayment({...officer,id:randomUUID()},id,null,null,photo),/Unassigned application/);
  await assert.rejects(recordPayment(officer,id,null,null,Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.from(randomUUID())])),/Receipt amount unreadable/);
  const auto=await recordPayment(officer,id,null,null,photo);
  assert.equal(auto.amount,125000);
  assert.equal(auto.amountSource,'read_auto');
  assert.deepEqual((await readPaymentReceipt(officer,auto.paymentId)).data,photo);
  await recordPayment(officer,id,400000,`TRF-${randomUUID()}`,receipt(),'read_confirmed');
  assert.equal((await pool.query('SELECT status FROM applications WHERE id=$1',[id])).rows[0].status,'paid_off');
  await assert.rejects(perform(manager,{type:'close',applicationId:id}),/Forbidden/);
  await perform(owner,{type:'close',applicationId:id});
});
