import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {branchOfficers,collectorWeek,dueList} from '@/lib/collections';
import CollectionList from '../ui/CollectionList';
export const dynamic='force-dynamic';

export default async function Collections({searchParams}:{searchParams:Promise<{penagih?:string}>}){
  const actor=await currentActor();
  if(!actor||actor.role==='customer')redirect('/');
  const {penagih}=await searchParams;
  const collectorId=actor.role!=='officer'&&penagih&&/^[0-9a-f-]{36}$/i.test(penagih)?penagih:undefined;
  const [items,week,officers]=await Promise.all([dueList(actor,{collectorId}),actor.role==='officer'?collectorWeek(actor.id):Promise.resolve(null),
    actor.role==='officer'?Promise.resolve([]):branchOfficers(actor)]);
  return <CollectionList actor={{id:actor.id,name:actor.name,role:actor.role}} items={JSON.parse(JSON.stringify(items))} week={week} officers={officers} collectorId={collectorId??''}/>;
}
