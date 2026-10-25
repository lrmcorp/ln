import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {pool} from '@/lib/db';
import IntakeWizard from '@/app/ui/IntakeWizard';

export const dynamic='force-dynamic';
export default async function NewApplication(){
  const actor=await currentActor();
  if(!actor||actor.role!=='officer')redirect('/');
  const policy=(await pool.query('SELECT version,min_principal,max_principal,flat_interest_bps,min_months,max_months,late_fee_monthly_bps FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
  if(!policy)return <main className="intakePage"><h1>Kebijakan belum tersedia</h1></main>;
  return <IntakeWizard policy={JSON.parse(JSON.stringify(policy))}/>;
}
