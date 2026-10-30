import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {customerLocation} from '@/lib/location';
import {homeDashboard} from '@/lib/dashboard';
import StaffConsole from './ui/StaffConsole';
import LocationApp from './ui/LocationApp';
import Dashboard from './ui/Dashboard';
export const dynamic='force-dynamic';
const uuid=(value?:string)=>value&&/^[0-9a-f-]{36}$/i.test(value)?value:null;

export default async function Home({searchParams}:{searchParams:Promise<{cabang?:string}>}){
  const actor=await currentActor();
  if(actor?.role==='customer') return <LocationApp blank name={actor.name==='Demo Borrower'?'Nasabah Demo':actor.name} initial={JSON.parse(JSON.stringify(await customerLocation(actor)))}/>;
  // Field officers start the day from their collection list.
  if(actor?.role==='officer') redirect('/tagihan');
  if(!actor) return <StaffConsole/>;
  const branch=actor.role==='owner'?uuid((await searchParams).cabang):null;
  const data=await homeDashboard(actor,{branchId:branch});
  return <Dashboard actor={{id:actor.id,name:actor.name,role:actor.role}} data={JSON.parse(JSON.stringify(data))} branch={branch??''}/>;
}
