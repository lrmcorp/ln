import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../lib/db';
import {borrowerLookup,createIntake} from '../lib/intake';
import {recordPayment} from '../lib/payments';
import {perform} from '../lib/workflow';
import {activeWeeklyLoan,demoActors,ensureWeeklyPolicy,ktp,pngReceipt,uniqueNik,video} from './helpers';

let actors:Awaited<ReturnType<typeof demoActors>>;
before(async()=>{actors=await demoActors();await ensureWeeklyPolicy(actors.owner);});

const base=(name:string,nik:string)=>({name,nik,dateOfBirth:'1990-01-01',phone:'081234567890',address:'Alamat rekaan',motherName:'Ibu Rekaan',
  bankName:'Bank Demo',bankAccountNumber:'1234567890',accountHolder:name,occupation:'',loanPurpose:''});

test('first loans are capped and the weekly installment must fit the income share',async()=>{
  const nik=uniqueNik(),name=`Nasabah Baru ${randomUUID().slice(0,6)}`;
  assert.deepEqual(await borrowerLookup(actors.officer,nik,name),{limit:1000000,repeat:false,reason:'Pinjaman pertama',maxInstallmentShareBps:3500});
  await assert.rejects(createIntake(actors.officer,{...base(name,nik),principal:1500000,weeks:5,weeklyIncome:5000000},ktp,video),/Above borrowing limit/);
  // Rp125.000 per week is more than 35% of Rp300.000.
  await assert.rejects(createIntake(actors.officer,{...base(name,nik),principal:500000,weeks:5,weeklyIncome:300000},ktp,video),/Installment exceeds income share/);
});

test('a borrower who paid on time returns with a higher limit; open loans and name mismatches are blocked',async()=>{
  const nik=uniqueNik(),name=`Nasabah Lama ${randomUUID().slice(0,6)}`;
  const {id}=await activeWeeklyLoan(actors,800000,4,{nik,name});
  await assert.rejects(borrowerLookup(actors.officer,nik,name),/open loan/);
  await recordPayment(actors.manager,id,960000,pngReceipt());
  await perform(actors.owner,{type:'close',applicationId:id});
  assert.deepEqual(await borrowerLookup(actors.officer,nik,name),{limit:1200000,repeat:true,reason:'Lunas tepat waktu',maxInstallmentShareBps:3500});
  await assert.rejects(borrowerLookup(actors.officer,nik,'Nama Lain'),/Name does not match/);
  const other={...actors.officer,branch_id:randomUUID()};
  await assert.rejects(borrowerLookup(other,nik,name),/another branch/);
  const again=await createIntake(actors.officer,{...base(name,nik),principal:1200000,weeks:6,weeklyIncome:2000000},ktp,video);
  const rows=(await pool.query('SELECT customer_id FROM applications WHERE id=ANY($1)',[[id,again.id]])).rows;
  assert.equal(new Set(rows.map(row=>row.customer_id)).size,1,'same customer record reused');
});
