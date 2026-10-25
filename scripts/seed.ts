import {pool} from '../lib/db';
import {hashPassword} from '../lib/auth';

const ownerPassword=process.env.DEMO_OWNER_PASSWORD;
const managerPassword=process.env.DEMO_MANAGER_PASSWORD;
const officerPassword=process.env.DEMO_OFFICER_PASSWORD;
const customerPassword=process.env.DEMO_CUSTOMER_PASSWORD;
if(!ownerPassword||!managerPassword||!officerPassword||!customerPassword) throw new Error('Set all four demo passwords in .env.local');
const branch=await pool.query('INSERT INTO branches(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id',['Jakarta Pusat']);
const branchId=branch.rows[0].id;
const customer=await pool.query('INSERT INTO customers(name,branch_id) SELECT $1,$2 WHERE NOT EXISTS(SELECT 1 FROM customers WHERE name=$1 AND branch_id=$2) RETURNING id',['Demo Borrower',branchId]);
const customerId=customer.rows[0]?.id ?? (await pool.query('SELECT id FROM customers WHERE name=$1 AND branch_id=$2 LIMIT 1',['Demo Borrower',branchId])).rows[0].id;
for(const [email,name,role,password,cid] of [
  ['owner@local.test','Demo Owner','owner',ownerPassword,null],
  ['manager@local.test','Demo Manager','manager',managerPassword,null],
  ['officer@local.test','Demo Officer','officer',officerPassword,null],
  ['customer@local.test','Demo Borrower','customer',customerPassword,customerId]
] as const){
  await pool.query('INSERT INTO users(email,name,role,branch_id,customer_id,password_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO NOTHING',[email,name,role,branchId,cid,hashPassword(password)]);
}
await pool.query('INSERT INTO policy_versions(version,min_principal,max_principal,flat_interest_bps,min_weeks,max_weeks) VALUES(1,100000,5000000,200,1,52) ON CONFLICT(version) DO NOTHING');
console.log('Demo branch, users and policy ready');
await pool.end();
