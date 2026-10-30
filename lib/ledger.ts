import type {PoolClient} from 'pg';
import {assertBalanced} from './finance';

// Accounts. Unearned interest and the loss allowance are contra balances to the receivables;
// cash in transit holds field cash until the officer's daily deposit is confirmed.
export const A={
  cash:'cash',cashInTransit:'cash_in_transit',
  principal:'principal_receivable',interest:'interest_receivable',unearned:'unearned_interest',fee:'fee_receivable',
  interestIncome:'interest_income',feeIncome:'late_fee_income',recoveryIncome:'recovery_income',
  allowance:'loan_loss_allowance',provisionExpense:'provision_expense',badDebtExpense:'bad_debt_expense',
  ownerCapital:'owner_capital',investorCapital:'investor_capital',distributions:'capital_distributions'
} as const;

export type Line={account:string;debit:number;credit:number};
export const dr=(account:string,amount:number):Line=>({account,debit:amount,credit:0});
export const cr=(account:string,amount:number):Line=>({account,debit:0,credit:amount});

export async function journal(c:PoolClient,appId:string|null,type:string,sourceId:string,lines:Line[]){
  const kept=lines.filter(line=>line.debit||line.credit);
  if(!kept.length)return;
  assertBalanced(kept);
  const j=await c.query('INSERT INTO journals(application_id,event_type,source_id) VALUES($1,$2,$3) RETURNING id',[appId,type,sourceId]);
  for(const line of kept)await c.query('INSERT INTO journal_lines(journal_id,account,debit,credit) VALUES($1,$2,$3,$4)',[j.rows[0].id,line.account,line.debit,line.credit]);
}

export type Balances={principal:number;interest:number;unearned:number;fee:number;allowance:number};

// Debit-positive balances for asset accounts; unearned and allowance are returned as positive credit balances.
export async function loanBalances(c:PoolClient,appId:string):Promise<Balances>{
  const rows=(await c.query(`SELECT l.account,COALESCE(SUM(l.debit-l.credit),0)::bigint AS balance
    FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.application_id=$1 GROUP BY l.account`,[appId])).rows;
  const get=(account:string)=>Number(rows.find(row=>row.account===account)?.balance??0);
  return {principal:get(A.principal),interest:get(A.interest),unearned:0-get(A.unearned)||0,fee:get(A.fee),allowance:0-get(A.allowance)||0};
}
