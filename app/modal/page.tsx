import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {capitalReport} from '@/lib/admin';
import {todayIso} from '@/lib/accounting';
import {listBranches} from '@/lib/admin';
import CapitalPage from '../ui/CapitalPage';
export const dynamic='force-dynamic';

export default async function Capital(){
  const actor=await currentActor();
  if(!actor||actor.role!=='owner')redirect('/');
  const [report,branches]=await Promise.all([capitalReport(actor),listBranches(actor)]);
  return <CapitalPage actor={{id:actor.id,name:actor.name,role:actor.role}} report={JSON.parse(JSON.stringify(report))} today={todayIso()} branches={branches.map(b=>({id:b.id,name:b.name}))}/>;
}
