import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {portfolioReport} from '@/lib/reports';
import {branchOfficers} from '@/lib/collections';
import {pool} from '@/lib/db';
import ReportPage from '../ui/ReportPage';
export const dynamic='force-dynamic';
const uuid=(value?:string)=>value&&/^[0-9a-f-]{36}$/i.test(value)?value:null;

export default async function Reports({searchParams}:{searchParams:Promise<{cabang?:string;penagih?:string}>}){
  const actor=await currentActor();
  if(!actor||(actor.role!=='owner'&&actor.role!=='manager'))redirect('/');
  const params=await searchParams;
  const filter={branchId:uuid(params.cabang),collectorId:uuid(params.penagih)};
  const [report,officers,branches]=await Promise.all([portfolioReport(actor,filter),branchOfficers(actor,filter.branchId??undefined),
    actor.role==='owner'?pool.query('SELECT id,name FROM branches ORDER BY name').then(r=>r.rows):Promise.resolve([])]);
  return <ReportPage actor={{id:actor.id,name:actor.name,role:actor.role}} report={JSON.parse(JSON.stringify(report))} officers={officers} branches={branches} filter={{branchId:filter.branchId??'',collectorId:filter.collectorId??''}}/>;
}
