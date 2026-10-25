import {currentActor} from '@/lib/auth';
import {dashboard} from '@/lib/read-model';
import {customerLocation} from '@/lib/location';
import {redirect} from 'next/navigation';
import Console from './ui/Console';
import LocationApp from './ui/LocationApp';
export const dynamic='force-dynamic';
export default async function Home(){
  const actor=await currentActor();
  if(actor?.role==='manager') redirect('/lokasi');
  if(actor?.role==='customer') return <LocationApp blank name={actor.name==='Demo Borrower'?'Nasabah Demo':actor.name} initial={JSON.parse(JSON.stringify(await customerLocation(actor)))}/>;
  const staff=actor&&(actor.role==='owner'||actor.role==='officer')?{...actor,role:actor.role}:null;
  const data=staff?await dashboard(staff):null;
  return <Console actor={staff} initial={data?JSON.parse(JSON.stringify(data)):null}/>;
}
