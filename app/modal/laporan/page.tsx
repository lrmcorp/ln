import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {capitalReport} from '@/lib/admin';
import {portfolioReport} from '@/lib/reports';
import {profitReport} from '@/lib/profit';
import {todayIso} from '@/lib/accounting';
import InvestorReport from '../../ui/InvestorReport';
export const dynamic='force-dynamic';

export default async function InvestorReportPage({searchParams}:{searchParams:Promise<{bulan?:string}>}){
  const actor=await currentActor();
  if(!actor||actor.role!=='owner')redirect('/');
  const today=todayIso();
  const requested=(await searchParams).bulan;
  const month=requested&&/^\d{4}-\d{2}$/.test(requested)&&requested<=today.slice(0,7)?requested:today.slice(0,7);
  const [capital,portfolio,profit]=await Promise.all([capitalReport(actor),portfolioReport(actor),profitReport(actor)]);
  return <InvestorReport month={month} today={today} capital={JSON.parse(JSON.stringify(capital))} portfolio={JSON.parse(JSON.stringify(portfolio))} profit={JSON.parse(JSON.stringify(profit))}/>;
}
