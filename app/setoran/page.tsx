import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {officerDeposits} from '@/lib/payments';
import DepositPage from '../ui/DepositPage';
export const dynamic='force-dynamic';

export default async function Deposits(){
  const actor=await currentActor();
  if(!actor||actor.role!=='officer')redirect('/');
  const data=await officerDeposits(actor);
  return <DepositPage actor={{id:actor.id,name:actor.name,role:actor.role}} data={JSON.parse(JSON.stringify(data))}/>;
}
