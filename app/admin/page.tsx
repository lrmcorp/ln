import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {listBranches,listUsers} from '@/lib/admin';
import AdminPage from '../ui/AdminPage';
export const dynamic='force-dynamic';

export default async function Admin(){
  const actor=await currentActor();
  if(!actor||actor.role!=='owner')redirect('/');
  const [branches,users]=await Promise.all([listBranches(actor),listUsers(actor)]);
  return <AdminPage actor={{id:actor.id,name:actor.name,role:actor.role}} branches={branches} users={users}/>;
}
