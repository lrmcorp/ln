import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {monitorLocations} from '@/lib/location';
import LocationMonitor from '../ui/LocationMonitor';

export const dynamic='force-dynamic';
export default async function Lokasi(){
  const actor=await currentActor();
  if(!actor||!['owner','manager'].includes(actor.role)) redirect('/');
  const initial=await monitorLocations(actor);
  return <LocationMonitor actor={{id:actor.id,name:actor.name,role:actor.role as 'owner'|'manager'}} initial={JSON.parse(JSON.stringify(initial))}/>;
}
