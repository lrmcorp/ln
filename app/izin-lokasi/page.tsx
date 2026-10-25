import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {customerLocation} from '@/lib/location';
import LocationApp from '@/app/ui/LocationApp';

export const dynamic='force-dynamic';
export default async function LocationPermissionPage(){
  const actor=await currentActor();
  if(!actor||actor.role!=='customer')redirect('/');
  return <LocationApp name={actor.name==='Demo Borrower'?'Nasabah Demo':actor.name} initial={JSON.parse(JSON.stringify(await customerLocation(actor)))}/>;
}
