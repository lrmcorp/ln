import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {pool} from '@/lib/db';
import ManualLoanPage from '../../ui/ManualLoanPage';
export const dynamic='force-dynamic';

export default async function AddLoan({searchParams}:{searchParams:Promise<{mode?:string}>}){
  const actor=await currentActor();
  if(!actor||(actor.role!=='owner'&&actor.role!=='manager'))redirect('/');
  const branchScope=actor.role==='manager'?'AND u.branch_id=$1':'';
  const params=actor.role==='manager'?[actor.branch_id]:[];
  const [policy,officers,branches]=await Promise.all([
    pool.query('SELECT min_principal,max_principal,weekly_rates FROM policy_versions ORDER BY version DESC LIMIT 1').then(r=>r.rows[0]??null),
    pool.query(`SELECT u.id,u.name,u.branch_id FROM users u WHERE u.role='officer' AND u.active ${branchScope} ORDER BY u.name`,params).then(r=>r.rows),
    actor.role==='owner'?pool.query('SELECT id,name FROM branches ORDER BY name').then(r=>r.rows):Promise.resolve([])
  ]);
  const mode=(await searchParams).mode==='lama'?'import':'quick';
  return <ManualLoanPage actor={{id:actor.id,name:actor.name,role:actor.role}} policy={JSON.parse(JSON.stringify(policy))} officers={officers} branches={branches} initialMode={mode}/>;
}
