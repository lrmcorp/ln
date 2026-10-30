import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import StaffConsole from '../ui/StaffConsole';
export const dynamic='force-dynamic';
export default async function Loans(){
  const actor=await currentActor();
  if(!actor||actor.role==='customer')redirect('/');
  return <StaffConsole/>;
}
