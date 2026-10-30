import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../lib/db';
import type {Actor} from '../lib/auth';
import {verifyPassword} from '../lib/auth';
import {addDays,todayIso} from '../lib/accounting';
import {assignCollector,collectorWeek,dueList,logVisit,whatsappLink} from '../lib/collections';
import {portfolioReport,reportCsv} from '../lib/reports';
import {capitalReport,createBranch,createUser,recordCapital,updateUser} from '../lib/admin';
import {accountBalance,activeWeeklyLoan,backdate,demoActors,ensureWeeklyPolicy} from './helpers';

let actors:Awaited<ReturnType<typeof demoActors>>;
before(async()=>{actors=await demoActors();await ensureWeeklyPolicy(actors.owner);});

const actorById=async(id:string)=>(await pool.query<Actor>('SELECT id,name,email,role,branch_id,customer_id FROM users WHERE id=$1',[id])).rows[0];

test('managers assign collectors; the collector sees the loan, logs visits and promises',async()=>{
  const username=`petugas${randomUUID().slice(0,6)}`;
  const {id:collectorId}=await createUser(actors.owner,{username,name:'Petugas Kedua',role:'officer',branchId:actors.manager.branch_id!,password:'rahasia123'});
  const collector=await actorById(collectorId);
  const {id}=await activeWeeklyLoan(actors);
  await backdate(id,3);
  await assert.rejects(assignCollector(actors.officer,id,collectorId),/Forbidden/);
  await assert.rejects(assignCollector(actors.manager,id,actors.manager.id),/active officer/);
  await assignCollector(actors.manager,id,collectorId);
  const mine=await dueList(collector);
  const item=mine.find(row=>row.id===id);
  assert.ok(item);
  assert.equal(item.bucket,'late');
  assert.equal(item.dpd,3);
  assert.ok(!(await dueList(actors.officer)).some(row=>row.id===id),'originating officer no longer collects it');
  await assert.rejects(logVisit(actors.officer,id,'not_home',null,''),/Forbidden/);
  await assert.rejects(logVisit(collector,id,'promise',addDays(todayIso(),30),''),/14 days/);
  await logVisit(collector,id,'promise',addDays(todayIso(),2),'Gajian hari Jumat');
  assert.equal((await dueList(collector)).find(row=>row.id===id)?.lastVisit?.outcome,'promise');
  const week=await collectorWeek(collectorId);
  assert.ok(week.collected<=week.due);
});

test('WhatsApp links use the international number format',()=>{
  assert.equal(whatsappLink('0812-3456-7890','Halo'),'https://wa.me/6281234567890?text=Halo');
  assert.equal(whatsappLink('+62 812 3456 7890','a b'),'https://wa.me/6281234567890?text=a%20b');
  assert.equal(whatsappLink('123',''),null);
});

test('portfolio report shows PAR buckets, officer performance and Excel-ready CSV',async()=>{
  const {id}=await activeWeeklyLoan(actors);
  await backdate(id,9);
  const report=await portfolioReport(actors.owner);
  const loan=report.loans.find(row=>row.id===id);
  assert.equal(loan?.dpd,9);
  assert.ok(report.par7.count>=1&&report.par30.count<=report.par7.count&&report.par7.count<=report.par1.count);
  assert.ok(report.officers.length>=1);
  assert.equal(report.cashflow.length,12);
  assert.ok(report.week.rate<=100&&report.officers.every(o=>o.rate<=100),'collection efficiency is capped per loan');
  const managerView=await portfolioReport(actors.manager,{branchId:randomUUID()});
  assert.ok(managerView.loans.some(row=>row.id===id),'managers are always scoped to their own branch');
  await assert.rejects(portfolioReport(actors.officer),/Forbidden/);
  const csv=await reportCsv(actors.owner,'pinjaman',{});
  assert.ok(csv.startsWith('﻿Nasabah;Cabang;'));
});

test('owner manages branches and users; inactive users cannot sign in',async()=>{
  await assert.rejects(createBranch(actors.manager,'Cabang X'),/Forbidden/);
  const {id:branchId}=await createBranch(actors.owner,`Cabang ${randomUUID().slice(0,6)}`);
  await assert.rejects(createUser(actors.owner,{username:'A B',name:'x',role:'officer',branchId,password:'12345678'}),/Invalid user/);
  const username=`manajer${randomUUID().slice(0,6)}`;
  const {id}=await createUser(actors.owner,{username,name:'Manajer Baru',role:'manager',branchId,password:'awal1234'});
  await updateUser(actors.owner,id,{password:'baru5678'});
  const row=(await pool.query('SELECT password_hash,active FROM users WHERE id=$1',[id])).rows[0];
  assert.ok(verifyPassword('baru5678',row.password_hash));
  await updateUser(actors.owner,id,{active:false});
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE lower(username)=$1 AND active`,[username])).rows[0].n,0);
  await assert.rejects(updateUser(actors.owner,actors.owner.id,{active:false}),/yourself/);
});

test('capital movements post to the ledger and feed the investor report',async()=>{
  const cash=await accountBalance(null,'cash');
  await recordCapital(actors.owner,{kind:'injection',source:'Investor Rekaan',sourceType:'investor',amount:10000000,annualCostBps:1200,date:todayIso(),note:''});
  assert.equal(await accountBalance(null,'cash')-cash,10000000);
  await assert.rejects(recordCapital(actors.owner,{kind:'withdrawal',source:'Investor Rekaan',sourceType:'investor',amount:10**12,annualCostBps:0,date:todayIso(),note:''}),/Not enough cash/);
  await assert.rejects(recordCapital(actors.manager,{kind:'injection',source:'x',sourceType:'owner',amount:1,annualCostBps:0,date:todayIso(),note:''}),/Forbidden/);
  const report=await capitalReport(actors.owner);
  assert.ok(report.sources.some(source=>source.source==='Investor Rekaan'&&source.net>=10000000));
  assert.ok(report.monthly.length>=1);
});
