import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {customerLocation} from '@/lib/location';
import StaffConsole from './ui/StaffConsole';
import LocationApp from './ui/LocationApp';
export const dynamic='force-dynamic';
export default async function Home(){
  const actor=await currentActor();
  if(actor?.role==='customer') return <LocationApp blank name={actor.name==='Demo Borrower'?'Nasabah Demo':actor.name} initial={JSON.parse(JSON.stringify(await customerLocation(actor)))}/>;
  // Field officers start the day from their collection list.
  if(actor?.role==='officer') redirect('/tagihan');
  return <StaffConsole/>;
}
