import {currentActor} from '@/lib/auth';
import {dashboard} from '@/lib/read-model';
import Console from './Console';

export default async function StaffConsole(){
  const actor=await currentActor();
  const staff=actor&&actor.role!=='customer'?{id:actor.id,name:actor.name,role:actor.role}:null;
  const data=staff?await dashboard(actor!):null;
  return <Console actor={staff} initial={data?JSON.parse(JSON.stringify(data)):null}/>;
}
