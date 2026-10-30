import type {Actor} from './auth';
import {requireRole} from './auth';
import {pool,transaction} from './db';
import {A,cr,dr,journal} from './ledger';
import {daysBetween,todayIso} from './accounting';
import {loans,type ReportFilter} from './reports';

export type ExpenseInput={month:string;category:string;branchId:string|null;amount:number;note:string};

// Operating costs are paid from company cash, so each one is journaled against cash like a capital withdrawal.
export async function recordExpense(actor:Actor|null,input:ExpenseInput){
  requireRole(actor,['owner']);
  if(!/^\d{4}-\d{2}$/.test(input.month)||`${input.month}-01`>todayIso()||!input.category.trim()||input.category.length>60||
    !Number.isSafeInteger(input.amount)||input.amount<=0||input.amount>1e12||input.note.length>500)throw new Error('Invalid expense');
  return transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(710103)');
    if(input.branchId&&!(await c.query('SELECT 1 FROM branches WHERE id=$1',[input.branchId])).rows[0])throw new Error('Invalid expense');
    const cash=Number((await c.query(`SELECT COALESCE(SUM(debit-credit),0)::bigint AS b FROM journal_lines WHERE account='cash'`)).rows[0].b);
    if(cash<input.amount)throw new Error('Not enough cash');
    const row=(await c.query(`INSERT INTO operating_expenses(branch_id,category,amount,expense_month,note,recorded_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [input.branchId,input.category.trim(),input.amount,`${input.month}-01`,input.note.trim()||null,actor.id])).rows[0];
    await journal(c,null,'operating_expense',row.id,[dr(A.operatingExpense,input.amount),cr(A.cash,input.amount)]);
    await c.query('INSERT INTO audit_events(actor_id,subject_type,subject_id,action,after_data) VALUES($1,$2,$3,$4,$5)',[actor.id,'expense',row.id,'expense_recorded',JSON.stringify(input)]);
    return {id:row.id as string};
  });
}

type Group={key:string;label:string;loans:number;principal:number;income:number;losses:number;funding:number;operating:number;net:number;margin:number};

// Profit per disbursed loan, grouped by tenor and by branch.
// Income: interest, late fees, recoveries. Losses: provisions and write-offs net of releases.
// Funding: principal times the weighted annual cost of recorded capital for the days the loan was out.
// Operating: recorded expenses, branch ones to that branch's loans and company-wide ones to all, split by principal-days.
export async function profitReport(actor:Actor,filter:ReportFilter={}){
  requireRole(actor,['owner','manager']);
  const today=todayIso();
  const all=(await loans(actor,filter)).filter(loan=>loan.disbursed_at);
  const ids=all.map(loan=>loan.id);
  const ledger=ids.length?(await pool.query(`SELECT j.application_id AS id,
      SUM(CASE WHEN l.account IN ('interest_income','late_fee_income','recovery_income') THEN l.credit-l.debit ELSE 0 END)::bigint AS income,
      SUM(CASE WHEN l.account IN ('provision_expense','bad_debt_expense') THEN l.debit-l.credit ELSE 0 END)::bigint AS losses,
      MAX(CASE WHEN j.event_type IN ('payment','recovery') THEN to_char(j.created_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') END) AS last_payment
    FROM journals j JOIN journal_lines l ON l.journal_id=j.id WHERE j.application_id=ANY($1) GROUP BY 1`,[ids])).rows:[];
  const byLoan=new Map(ledger.map(row=>[row.id as string,{income:Number(row.income),losses:Number(row.losses),last:row.last_payment as string|null}]));
  const capital=(await pool.query(`SELECT COALESCE(SUM(CASE WHEN kind='injection' THEN amount WHEN kind='withdrawal' THEN -amount ELSE 0 END),0)::bigint AS net,
      COALESCE(SUM(CASE WHEN kind='injection' THEN amount*annual_cost_bps ELSE 0 END),0)::numeric AS weighted,
      COALESCE(SUM(CASE WHEN kind='injection' THEN amount ELSE 0 END),0)::bigint AS injected FROM capital_movements`)).rows[0];
  const costBps=Number(capital.injected)?Number(capital.weighted)/Number(capital.injected):0;
  const expenses=(await pool.query(`SELECT branch_id,SUM(amount)::bigint AS total FROM operating_expenses GROUP BY branch_id`)).rows;
  const loanDays=(loan:typeof all[number])=>{
    const end=loan.status==='active'?today:byLoan.get(loan.id)?.last??today;
    return Math.max(1,daysBetween(loan.disbursed_at!,end<loan.disbursed_at!?loan.disbursed_at!:end));
  };
  // Expenses are allocated across every disbursed loan in the company, so a branch filter does not inflate its share.
  const everyLoan=filter.branchId||actor.role==='manager'||filter.collectorId?(await pool.query(`SELECT a.id,a.branch_id,COALESCE(a.approved_principal,0)::bigint AS principal,
      GREATEST(1,((CASE WHEN a.status='active' THEN (now() AT TIME ZONE 'Asia/Jakarta')::date ELSE COALESCE((SELECT MAX(p.created_at AT TIME ZONE 'Asia/Jakarta')::date FROM payments p WHERE p.application_id=a.id AND p.status<>'rejected'),(now() AT TIME ZONE 'Asia/Jakarta')::date) END)
        -(a.disbursed_at AT TIME ZONE 'Asia/Jakarta')::date))::int AS days
      FROM applications a WHERE a.disbursed_at IS NOT NULL`)).rows.map(row=>({id:row.id as string,branch:row.branch_id as string,weight:Number(row.principal)*Number(row.days)}))
    :all.map(loan=>({id:loan.id,branch:loan.branch_id,weight:loan.principal*loanDays(loan)}));
  const totalWeight=everyLoan.reduce((s,l)=>s+l.weight,0);
  const branchWeight=new Map<string,number>();for(const l of everyLoan)branchWeight.set(l.branch,(branchWeight.get(l.branch)??0)+l.weight);
  const companyWide=Number(expenses.find(row=>row.branch_id===null)?.total??0);
  const branchExpense=new Map(expenses.filter(row=>row.branch_id).map(row=>[row.branch_id as string,Number(row.total)]));
  const rows=all.map(loan=>{
    const days=loanDays(loan),weight=loan.principal*days,l=byLoan.get(loan.id)??{income:0,losses:0,last:null};
    const funding=Math.round(loan.principal*costBps/10000*days/365);
    const operating=Math.round((totalWeight?companyWide*weight/totalWeight:0)+((branchWeight.get(loan.branch_id)??0)?(branchExpense.get(loan.branch_id)??0)*weight/branchWeight.get(loan.branch_id)!:0));
    return {loan,income:l.income,losses:l.losses,funding,operating,net:l.income-l.losses-funding-operating};
  });
  const group=(keyOf:(r:typeof rows[number])=>{key:string;label:string})=>{
    const map=new Map<string,Group>();
    for(const r of rows){const {key,label}=keyOf(r);const g=map.get(key)??{key,label,loans:0,principal:0,income:0,losses:0,funding:0,operating:0,net:0,margin:0};
      g.loans++;g.principal+=r.loan.principal;g.income+=r.income;g.losses+=r.losses;g.funding+=r.funding;g.operating+=r.operating;g.net+=r.net;map.set(key,g);}
    return [...map.values()].map(g=>({...g,margin:g.principal?Math.round(g.net/g.principal*1000)/10:0}));
  };
  const total=group(()=>({key:'all',label:'Semua'}))[0]??null;
  return {costBps:Math.round(costBps),expenseTotal:companyWide+[...branchExpense.values()].reduce((s,v)=>s+v,0),total,
    byTenor:group(r=>({key:String(r.loan.term_weeks??0),label:r.loan.term_weeks?`${r.loan.term_weeks} minggu`:'Bulanan'})).sort((a,b)=>Number(a.key)-Number(b.key)),
    byBranch:group(r=>({key:r.loan.branch_id,label:r.loan.branch_name})).sort((a,b)=>b.net-a.net),
    expenses:(await pool.query(`SELECT e.id,to_char(e.expense_month,'YYYY-MM') AS month,e.category,e.amount::bigint AS amount,b.name AS branch,e.note FROM operating_expenses e LEFT JOIN branches b ON b.id=e.branch_id
      ${actor.role==='manager'?'WHERE e.branch_id=$1 OR e.branch_id IS NULL':''} ORDER BY e.expense_month DESC,e.created_at DESC LIMIT 24`,actor.role==='manager'?[actor.branch_id]:[])).rows.map(row=>({...row,amount:Number(row.amount)}))};
}
