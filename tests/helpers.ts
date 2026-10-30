import {randomUUID} from 'node:crypto';
import {pool} from '../lib/db';
import type {Actor} from '../lib/auth';
import {createIntake,signApplication,signingPreview} from '../lib/intake';
import {perform} from '../lib/workflow';

export async function demoActors(){
  const rows=(await pool.query<Actor>(`SELECT id,name,email,role,branch_id,customer_id FROM users WHERE email IN ('owner@local.test','manager@local.test','officer@local.test','customer@local.test')`)).rows;
  const by=(role:string)=>rows.find(row=>row.role===role)!;
  return {owner:by('owner'),manager:by('manager'),officer:by('officer'),customer:by('customer')};
}

export const uniqueNik=()=>randomUUID().replace(/\D/g,'').padEnd(16,'0').slice(0,16);
export const pngReceipt=()=>Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from(randomUUID())]);
export const ktp=Buffer.from([255,216,255,...Array(20).fill(0),255,217]);
export const video=Buffer.from([26,69,223,163,...Array(20).fill(0)]);
const signature=Buffer.from([137,80,78,71,13,10,26,10,...Array(300).fill(0)]);

export async function ensureWeeklyPolicy(owner:Actor){
  await perform(owner,{type:'policy',minPrincipal:100000,maxPrincipal:5000000,weeklyRates:[{weeks:4,rateBps:2000},{weeks:5,rateBps:2500},{weeks:6,rateBps:3000}],lateFeeMonthlyBps:500});
}

// Runs a synthetic borrower from officer intake to an active, disbursed weekly loan.
export async function activeWeeklyLoan(actors:Awaited<ReturnType<typeof demoActors>>,principal=500000,weeks=5,extra:Record<string,unknown>={}){
  const name=String(extra.name??`Nasabah Uji ${randomUUID().slice(0,8)}`);
  const {id}=await createIntake(actors.officer,{nik:uniqueNik(),dateOfBirth:'1990-01-01',phone:'081234567890',address:'Alamat rekaan',motherName:'Ibu Rekaan',
    bankName:'Bank Demo',bankAccountNumber:'1234567890',accountHolder:name,occupation:'',loanPurpose:'',principal,weeks,weeklyIncome:2000000,...extra,name},ktp,video);
  const preview=await signingPreview(actors.officer,id);
  await signApplication(actors.officer,id,name,true,preview.quote.hash,signature);
  await perform(actors.owner,{type:'review_evidence',applicationId:id,reason:'Bukti rekaan ditinjau'});
  await perform(actors.owner,{type:'approve',applicationId:id});
  await perform(actors.owner,{type:'authorize',applicationId:id});
  await perform(actors.owner,{type:'initiate',applicationId:id,idempotencyKey:randomUUID()});
  await perform(actors.owner,{type:'confirm',applicationId:id,bankReference:`${Date.now()}${Math.floor(Math.random()*1e6)}`,proof:'Bukti penyelesaian demo'});
  return {id,name};
}

export async function accountBalance(appId:string|null,account:string){
  const row=(await pool.query(`SELECT COALESCE(SUM(l.debit-l.credit),0)::bigint AS b FROM journal_lines l JOIN journals j ON j.id=l.journal_id
    WHERE ${appId?'j.application_id=$2':'$2::uuid IS NULL'} AND l.account=$1`,[account,appId])).rows[0];
  return Number(row.b);
}

// Moves the whole schedule so that installment 1 fell due `daysAgo` days ago.
export async function backdate(appId:string,daysAgo:number){
  await pool.query(`UPDATE installments SET due_at=(now() AT TIME ZONE 'Asia/Jakarta')::date - $2::int + (sequence-1)*7 WHERE application_id=$1`,[appId,daysAgo]);
  await pool.query('UPDATE applications SET fee_accrued_through=NULL WHERE id=$1',[appId]);
}
