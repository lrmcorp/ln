import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {pool} from '@/lib/db';
import PolicyPage from '../ui/PolicyPage';
export const dynamic='force-dynamic';

export default async function Policy(){
  const actor=await currentActor();
  if(!actor||actor.role!=='owner')redirect('/');
  const policy=(await pool.query('SELECT version,min_principal,max_principal,late_fee_monthly_bps,weekly_rates,first_loan_max,repeat_growth_bps,max_installment_income_bps,max_officer_exposure,max_branch_exposure,created_at FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0]??null;
  return <PolicyPage actor={{id:actor.id,name:actor.name,role:actor.role}} policy={JSON.parse(JSON.stringify(policy))}/>;
}
