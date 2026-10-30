import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {pool} from '@/lib/db';
import IntakeWizard from '@/app/ui/IntakeWizard';

export const dynamic='force-dynamic';
export default async function NewApplication(){
  const actor=await currentActor();
  if(!actor||(actor.role!=='officer'&&actor.role!=='manager'))redirect('/');
  const policy=(await pool.query('SELECT version,min_principal,max_principal,late_fee_monthly_bps,weekly_rates FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
  if(!policy)return <main className="intakePage"><h1>Kebijakan belum tersedia</h1></main>;
  const officers=actor.role==='manager'?(await pool.query(`SELECT id,name FROM users WHERE role='officer' AND active AND branch_id=$1 ORDER BY name`,[actor.branch_id])).rows:[];
  return <IntakeWizard policy={JSON.parse(JSON.stringify(policy))} officers={officers}/>;
}
