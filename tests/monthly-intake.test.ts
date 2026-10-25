import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../lib/db';
import type {Actor} from '../lib/auth';
import {createMonthlyIntake,signMonthlyApplication,signingPreview} from '../lib/intake';
import {readIntakeEvidence} from '../lib/evidence';
import {perform} from '../lib/workflow';

test('monthly intake requires borrower signature and owner evidence review before approval',async()=>{
  const users=await pool.query<Actor>('SELECT id,name,email,role,branch_id,customer_id FROM users WHERE email IN ($1,$2)',
    ['owner@local.test','officer@local.test']);
  const owner=users.rows.find(item=>item.role==='owner')!,officer=users.rows.find(item=>item.role==='officer')!;
  assert.ok(owner&&officer);
  const nik=`${randomUUID().replace(/\D/g,'').padEnd(16,'0').slice(0,16)}`;
  const ktp=Buffer.from([255,216,255,...Array(20).fill(0),255,217]);
  const video=Buffer.from([26,69,223,163,...Array(20).fill(0)]);
  const intake=await createMonthlyIntake(officer,{name:'Nasabah Uji Bulanan',nik,dateOfBirth:'1990-01-01',phone:'081234567890',address:'Alamat rekaan',motherName:'Ibu Rekaan',
    bankName:'Bank Demo',bankAccountNumber:'1234567890',accountHolder:'Nasabah Uji Bulanan',occupation:'',loanPurpose:'',principal:500000,months:3},ktp,video);
  const id=intake.id;
  await assert.rejects(perform(owner,{type:'approve',applicationId:id}),/Approval not allowed/);
  assert.deepEqual((await readIntakeEvidence(owner,id,'ktp')).data,ktp);
  await assert.rejects(readIntakeEvidence({...officer,id:randomUUID()},id,'ktp'),/Forbidden/);
  const preview=await signingPreview(officer,id);
  assert.equal(preview.quote.snapshot.schedule.length,3);
  assert.ok(preview.quote.snapshot.schedule.every(item=>item.dueAt.endsWith('-01')));
  await assert.rejects(signMonthlyApplication(officer,id,'Nama Berbeda',true,preview.quote.hash,Buffer.alloc(300)),/Invalid signature image/);
  const signature=Buffer.from([137,80,78,71,13,10,26,10,...Array(300).fill(0)]);
  await assert.rejects(signMonthlyApplication(officer,id,'Nasabah Uji Bulanan',true,'0'.repeat(64),signature),/Terms changed/);
  const signed=await signMonthlyApplication(officer,id,'Nasabah Uji Bulanan',true,preview.quote.hash,signature);
  assert.equal(signed.hash,preview.quote.hash);
  await assert.rejects(perform(owner,{type:'approve',applicationId:id}),/Identity review required/);
  await perform(owner,{type:'review_evidence',applicationId:id,reason:'Bukti rekaan ditinjau'});
  const approved=await perform(owner,{type:'approve',applicationId:id});
  assert.equal(approved.hash,preview.quote.hash);
  const state=await pool.query('SELECT status,approved_principal,interest_amount FROM applications WHERE id=$1',[id]);
  assert.equal(state.rows[0].status,'signed');
  assert.equal(Number(state.rows[0].approved_principal),500000);
  assert.equal(Number(state.rows[0].interest_amount),preview.quote.snapshot.interest);
});
