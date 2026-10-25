import {currentActor} from '@/lib/auth';
import {dashboard} from '@/lib/read-model';
import Console from './ui/Console';
export const dynamic='force-dynamic';
export default async function Home(){
  const actor=await currentActor();
  const data=actor?await dashboard(actor):null;
  return <Console actor={actor} initial={data?JSON.parse(JSON.stringify(data)):null}/>;
}
