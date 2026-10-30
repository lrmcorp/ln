import type {Actor} from './auth';
import {hashPassword,requireRole} from './auth';
import {pool,transaction} from './db';
import {A,cr,dr,journal} from './ledger';
import {todayIso} from './accounting';
import {ledgerSummary} from './reports';

const usernamePattern=/^[a-z0-9._-]{3,40}$/;

export async function listBranches(actor:Actor){
  requireRole(actor,['owner']);
  return (await pool.query(`SELECT b.id,b.name,
      (SELECT COUNT(*) FROM users u WHERE u.branch_id=b.id AND u.active AND u.role IN ('manager','officer'))::int AS staff,
      (SELECT COUNT(*) FROM applications a WHERE a.branch_id=b.id AND a.status='active')::int AS active_loans
    FROM branches b ORDER BY b.name`)).rows as {id:string;name:string;staff:number;active_loans:number}[];
}

export async function createBranch(actor:Actor|null,name:string){
  requireRole(actor,['owner']);
  if(!name.trim()||name.length>100)throw new Error('Invalid branch');
  const row=(await pool.query('INSERT INTO branches(name) VALUES($1) RETURNING id',[name.trim()])).rows[0];
  await pool.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',[actor.id,'branch',row.id,'branch_created',JSON.stringify({name:name.trim()})]);
  return {id:row.id as string};
}

export async function listUsers(actor:Actor){
  requireRole(actor,['owner']);
  return (await pool.query(`SELECT u.id,u.username,u.email,u.name,u.role,u.active,u.branch_id,b.name AS branch_name FROM users u LEFT JOIN branches b ON b.id=u.branch_id
    WHERE u.role<>'customer' ORDER BY u.active DESC,b.name,u.role,u.name`)).rows as {id:string;username:string|null;email:string;name:string;role:string;active:boolean;branch_id:string|null;branch_name:string|null}[];
}

export async function createUser(actor:Actor|null,input:{username:string;name:string;role:string;branchId:string;password:string}){
  requireRole(actor,['owner']);
  const username=input.username.trim().toLowerCase();
  if(!usernamePattern.test(username)||!input.name.trim()||input.name.length>200||!['owner','manager','officer'].includes(input.role)||input.password.length<8||input.password.length>200)
    throw new Error('Invalid user');
  const branch=(await pool.query('SELECT id FROM branches WHERE id=$1',[input.branchId])).rows[0];
  if(!branch)throw new Error('Invalid user');
  const row=(await pool.query(`INSERT INTO users(email,username,name,role,branch_id,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [`${username}@pengguna.ln`,username,input.name.trim(),input.role,input.branchId,hashPassword(input.password)])).rows[0];
  await pool.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',[actor.id,'user',row.id,'user_created',JSON.stringify({username,role:input.role,branchId:input.branchId})]);
  return {id:row.id as string};
}

export async function updateUser(actor:Actor|null,userId:string,change:{password?:string;active?:boolean;branchId?:string}){
  requireRole(actor,['owner']);
  if(userId===actor.id&&change.active===false)throw new Error('Cannot deactivate yourself');
  return transaction(async c=>{
    const user=(await c.query(`SELECT id,role FROM users WHERE id=$1 AND role<>'customer' FOR UPDATE`,[userId])).rows[0];
    if(!user)throw new Error('Invalid user');
    if(change.password!==undefined){
      if(change.password.length<8||change.password.length>200)throw new Error('Invalid user');
      await c.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hashPassword(change.password),userId]);
    }
    if(change.active!==undefined)await c.query('UPDATE users SET active=$1 WHERE id=$2',[change.active,userId]);
    if(change.branchId){
      if(!(await c.query('SELECT 1 FROM branches WHERE id=$1',[change.branchId])).rows[0])throw new Error('Invalid user');
      await c.query('UPDATE users SET branch_id=$1 WHERE id=$2',[change.branchId,userId]);
    }
    await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',
      [actor.id,'user',userId,'user_updated',JSON.stringify({passwordReset:change.password!==undefined,active:change.active,branchId:change.branchId})]);
    return {id:userId};
  });
}

export type CapitalInput={kind:'injection'|'withdrawal'|'distribution';source:string;sourceType:'owner'|'investor';amount:number;annualCostBps:number;date:string;note:string};

// Injections credit capital; withdrawals return capital; distributions pay returns to a provider. Cash cannot go negative.
export async function recordCapital(actor:Actor|null,input:CapitalInput){
  requireRole(actor,['owner']);
  if(!['injection','withdrawal','distribution'].includes(input.kind)||!['owner','investor'].includes(input.sourceType)||!input.source.trim()||input.source.length>100||
    !Number.isSafeInteger(input.amount)||input.amount<=0||!Number.isSafeInteger(input.annualCostBps)||input.annualCostBps<0||input.annualCostBps>10000||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date)||input.date>todayIso()||input.note.length>500)throw new Error('Invalid capital movement');
  return transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(710103)');
    if(input.kind!=='injection'){
      const cash=Number((await c.query(`SELECT COALESCE(SUM(debit-credit),0)::bigint AS b FROM journal_lines WHERE account='cash'`)).rows[0].b);
      if(cash<input.amount)throw new Error('Not enough cash');
    }
    const row=(await c.query(`INSERT INTO capital_movements(kind,source,source_type,amount,annual_cost_bps,movement_date,note,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [input.kind,input.source.trim(),input.sourceType,input.amount,input.annualCostBps,input.date,input.note.trim()||null,actor.id])).rows[0];
    const capital=input.sourceType==='owner'?A.ownerCapital:A.investorCapital;
    const lines=input.kind==='injection'?[dr(A.cash,input.amount),cr(capital,input.amount)]:input.kind==='withdrawal'?[dr(capital,input.amount),cr(A.cash,input.amount)]:[dr(A.distributions,input.amount),cr(A.cash,input.amount)];
    await journal(c,null,`capital_${input.kind}`,row.id,lines);
    await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',[actor.id,'capital',row.id,`capital_${input.kind}`,JSON.stringify(input)]);
    return {id:row.id as string};
  });
}

export async function capitalReport(actor:Actor){
  requireRole(actor,['owner']);
  const ledger=await ledgerSummary(actor);
  const sources=(await pool.query(`SELECT source,source_type,
      SUM(CASE WHEN kind='injection' THEN amount WHEN kind='withdrawal' THEN -amount ELSE 0 END)::bigint AS net,
      SUM(CASE WHEN kind='distribution' THEN amount ELSE 0 END)::bigint AS distributed,
      MAX(annual_cost_bps) AS cost_bps FROM capital_movements GROUP BY source,source_type ORDER BY net DESC`)).rows
    .map(row=>({source:row.source as string,type:row.source_type as string,net:Number(row.net),distributed:Number(row.distributed),costBps:Number(row.cost_bps)}));
  const movements=(await pool.query(`SELECT m.id,m.kind,m.source,m.source_type,m.amount,m.annual_cost_bps,to_char(m.movement_date,'YYYY-MM-DD') AS date,m.note,u.name AS recorded_by
    FROM capital_movements m JOIN users u ON u.id=m.recorded_by ORDER BY m.movement_date DESC,m.created_at DESC LIMIT 50`)).rows;
  const monthly=(await pool.query(`SELECT to_char(date_trunc('month',j.created_at AT TIME ZONE 'Asia/Jakarta'),'YYYY-MM') AS month,
      SUM(CASE WHEN j.event_type='disbursement' AND l.account='principal_receivable' THEN l.debit ELSE 0 END)::bigint AS disbursed,
      SUM(CASE WHEN j.event_type IN ('payment','recovery') AND l.account IN ('cash','cash_in_transit') THEN l.debit ELSE 0 END)::bigint
        -SUM(CASE WHEN j.event_type='payment_reversal' AND l.account IN ('cash','cash_in_transit') THEN l.credit ELSE 0 END)::bigint AS collected,
      SUM(CASE WHEN l.account='interest_income' THEN l.credit-l.debit ELSE 0 END)::bigint AS interest_income,
      SUM(CASE WHEN l.account='late_fee_income' THEN l.credit-l.debit ELSE 0 END)::bigint AS fee_income,
      SUM(CASE WHEN l.account='recovery_income' THEN l.credit-l.debit ELSE 0 END)::bigint AS recovery_income,
      SUM(CASE WHEN l.account='provision_expense' THEN l.debit-l.credit ELSE 0 END)::bigint AS provisions,
      SUM(CASE WHEN l.account='bad_debt_expense' THEN l.debit-l.credit ELSE 0 END)::bigint AS write_offs,
      SUM(CASE WHEN l.account='operating_expense' THEN l.debit-l.credit ELSE 0 END)::bigint AS opex
    FROM journals j JOIN journal_lines l ON l.journal_id=j.id GROUP BY 1 ORDER BY 1 DESC LIMIT 12`)).rows
    .map(row=>{const income=Number(row.interest_income)+Number(row.fee_income)+Number(row.recovery_income),losses=Number(row.provisions)+Number(row.write_offs);
      return {month:row.month as string,disbursed:Number(row.disbursed),collected:Number(row.collected),income,losses,opex:Number(row.opex),net:income-losses-Number(row.opex)};});
  const deployed=ledger.principal;
  const capital=ledger.ownerCapital+ledger.investorCapital;
  const income=ledger.interestIncome+ledger.feeIncome+ledger.recoveryIncome,losses=ledger.provisionExpense+ledger.badDebt,opex=ledger.operatingExpense;
  const last=monthly[0];
  // Annualised from the latest month: net result over principal currently deployed.
  const annualYield=last&&deployed?Math.round(last.net*12/deployed*1000)/10:0;
  return {ledger,capital,deployed,idleCash:ledger.cash,inTransit:ledger.cashInTransit,income,losses,opex,net:income-losses-opex,
    utilisation:capital?Math.round(deployed/capital*1000)/10:0,annualYield,sources,movements,monthly};
}
