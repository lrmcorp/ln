import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {customerProfile} from '@/lib/customers';
import CustomerPage from '../../ui/CustomerPage';
export const dynamic='force-dynamic';

export default async function Customer({params}:{params:Promise<{customerId:string}>}){
  const actor=await currentActor();
  if(!actor||actor.role==='customer')redirect('/');
  const {customerId}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(customerId))redirect('/pinjaman');
  try{
    const profile=await customerProfile(actor,customerId);
    return <CustomerPage actor={{id:actor.id,name:actor.name,role:actor.role}} profile={JSON.parse(JSON.stringify(profile))}/>;
  }catch{redirect('/pinjaman');}
}
