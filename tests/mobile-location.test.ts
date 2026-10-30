import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../lib/db';
import {hashPassword,type Actor} from '../lib/auth';
import {perform} from '../lib/workflow';
import {recordPayment} from '../lib/payments';
import {activateMobileDevice,createMobileEnrollment,mobileDeviceStatus,reportMobileLocation,setMobileConsent} from '../lib/mobile-location';
import {customerLocation,monitorLocations} from '../lib/location';

test('paired Android device reports only for an active consented loan and stops at payoff',async()=>{
  const users=await pool.query<Actor>('SELECT id,name,email,role,branch_id,customer_id FROM users WHERE email IN ($1,$2)',
    ['owner@local.test','officer@local.test']);
  const owner=users.rows.find(row=>row.role==='owner')!,officer=users.rows.find(row=>row.role==='officer')!;
  assert.ok(owner&&officer);
  const customerId=(await pool.query('INSERT INTO customers(name,branch_id) VALUES($1,$2) RETURNING id',
    [`Nasabah APK ${randomUUID().slice(0,8)}`,officer.branch_id])).rows[0].id;
  const customer=(await pool.query<Actor>('INSERT INTO users(email,name,role,branch_id,customer_id,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,email,role,branch_id,customer_id',
    [`mobile-${randomUUID()}@local.test`,'Nasabah APK Uji','customer',officer.branch_id,customerId,hashPassword(randomUUID())])).rows[0];
  const application=await perform(officer,{type:'create',customerId,principal:500000,weeks:3});
  await assert.rejects(createMobileEnrollment(officer,application.id),/Active loan required/);
  await perform(owner,{type:'approve',applicationId:application.id});
  await perform(customer,{type:'sign',applicationId:application.id});
  await perform(owner,{type:'authorize',applicationId:application.id});
  await perform(owner,{type:'initiate',applicationId:application.id,idempotencyKey:randomUUID()});
  await perform(owner,{type:'confirm',applicationId:application.id,bankReference:Date.now().toString()+Math.floor(Math.random()*10000),proof:'Bukti transfer rekaan'});
  await assert.rejects(createMobileEnrollment(customer,application.id),/Forbidden/);
  const {code}=await createMobileEnrollment(officer,application.id);
  await assert.rejects(activateMobileDevice('invalid'),/Invalid enrollment code/);
  const {token}=await activateMobileDevice(code);
  await assert.rejects(activateMobileDevice(code),/Invalid enrollment code/);
  assert.deepEqual(await mobileDeviceStatus(token),{active:true,enabled:false,intervalSeconds:30});
  await assert.rejects(reportMobileLocation(token,-6.175,106.827,12),/Location consent required/);
  await setMobileConsent(token,true);
  assert.equal((await mobileDeviceStatus(token)).enabled,true);
  const report=await reportMobileLocation(token,-6.17532,106.82714,12);
  assert.equal(report.latitude,-6.175);
  assert.equal(report.longitude,106.827);
  assert.equal(report.accuracy_m,150);
  assert.ok((await monitorLocations(owner)).some(row=>row.customer_id===customerId&&row.latitude===-6.175));
  await setMobileConsent(token,false);
  assert.equal((await customerLocation(customer)).latitude,null);
  await assert.rejects(reportMobileLocation(token,-6.175,106.827,12),/Location consent required/);
  await setMobileConsent(token,true);
  const balance=await pool.query('SELECT approved_principal,interest_amount FROM applications WHERE id=$1',[application.id]);
  await recordPayment(owner,application.id,Number(balance.rows[0].approved_principal)+Number(balance.rows[0].interest_amount),
    Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.from(randomUUID())]),{});
  assert.equal((await customerLocation(customer)).enabled,false);
  await assert.rejects(mobileDeviceStatus(token),/Invalid device token/);
  assert.equal((await pool.query("SELECT status FROM applications WHERE id=$1",[application.id])).rows[0].status,"closed");
});
