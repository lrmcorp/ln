import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {monitorLocations} from '@/lib/location';
import LocationMonitor from '../ui/LocationMonitor';

export const dynamic='force-dynamic';
export default async function Lokasi(){
  const actor=await currentActor();
  if(!actor||!['owner','manager'].includes(actor.role)) redirect('/');
  const initial=await monitorLocations(actor);
  return <LocationMonitor role={actor.role as 'owner'|'manager'} name={actor.name==='Demo Owner'?'Pemilik Demo':actor.name==='Demo Manager'?'Manajer Demo':actor.name} initial={JSON.parse(JSON.stringify(initial))}/>;
}
