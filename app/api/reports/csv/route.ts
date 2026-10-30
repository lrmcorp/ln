import {currentActor} from '@/lib/auth';
import {reportCsv} from '@/lib/reports';

export async function GET(request:Request){
  const actor=await currentActor();
  if(!actor)return Response.json({error:'Silakan masuk terlebih dahulu'},{status:401});
  const url=new URL(request.url);
  const kind=url.searchParams.get('kind')??'pinjaman';
  if(!['pinjaman','petugas','vintage','arus-kas','target','roll-rate','laba'].includes(kind))return Response.json({error:'Jenis laporan tidak dikenal'},{status:404});
  const uuid=(value:string|null)=>value&&/^[0-9a-f-]{36}$/i.test(value)?value:null;
  try{
    const csv=await reportCsv(actor,kind,{branchId:uuid(url.searchParams.get('cabang')),collectorId:uuid(url.searchParams.get('penagih'))});
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
    return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="ln-${kind}-${day}.csv"`,'Cache-Control':'private, no-store'}});
  }catch{return Response.json({error:'Laporan tidak tersedia untuk peran Anda'},{status:403});}
}
