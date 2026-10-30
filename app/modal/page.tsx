import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {capitalReport} from '@/lib/admin';
import {todayIso} from '@/lib/accounting';
import CapitalPage from '../ui/CapitalPage';
export const dynamic='force-dynamic';

export default async function Capital(){
  const actor=await currentActor();
  if(!actor||actor.role!=='owner')redirect('/');
  const report=await capitalReport(actor);
  return <CapitalPage actor={{id:actor.id,name:actor.name,role:actor.role}} report={JSON.parse(JSON.stringify(report))} today={todayIso()}/>;
}
